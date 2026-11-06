import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { App } from './app';
import { appConfig } from './app.config';

describe('Angular routed authentication flow (controlled HTTP)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));
  it('runs login, landing, logout, recovery and missing-token navigation with real components', async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);
    http
      .expectOne('/api/auth/session')
      .flush({ error: { code: 'UNAUTHENTICATED' } }, { status: 401, statusText: 'Unauthorized' });
    await router.navigateByUrl('/login');
    await fixture.whenStable();
    fixture.detectChanges();
    const input = (id: string, value: string) => {
      const field = fixture.nativeElement.querySelector('#' + id) as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const submit = () =>
      fixture.nativeElement
        .querySelector('form')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    input('email', 'test@example.invalid');
    input('password', 'synthetic-password');
    submit();
    const login = http.expectOne('/api/auth/login');
    expect(login.request.body).toEqual({
      email: 'test@example.invalid',
      password: 'synthetic-password',
    });
    login.flush({ account: { id: 'synthetic' } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/');
    expect(fixture.nativeElement.textContent).toContain('Sessão ativa');
    fixture.nativeElement.querySelector('button').click();
    http.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/login');
    await router.navigateByUrl('/forgot-password');
    await fixture.whenStable();
    fixture.detectChanges();
    input('email', 'test@example.invalid');
    submit();
    http
      .expectOne('/api/auth/password-recovery')
      .flush(null, { status: 202, statusText: 'Accepted' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Se houver uma conta elegível');
    await router.navigateByUrl('/reset-password');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Link inválido ou indisponível');
    await router.navigateByUrl('/unknown');
    await fixture.whenStable();
    expect(router.url).toBe('/login');
    http.verify();
  });
  it('removes a synthetic reset fragment before router activation and submits only in the JSON body', async () => {
    window.history.replaceState(null, '', '/reset-password#token=' + 'A'.repeat(43));
    TestBed.configureTestingModule({
      imports: [App],
      providers: [...appConfig.providers, provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(App);
    expect(window.location.hash).toBe('');
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/auth/session').flush({ account: { id: 'other-account' } });
    await TestBed.inject(Router).navigateByUrl('/reset-password');
    await fixture.whenStable();
    fixture.detectChanges();
    for (const id of ['password', 'confirmation']) {
      const field = fixture.nativeElement.querySelector('#' + id) as HTMLInputElement;
      field.value = 'synthetic-password';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    const reset = http.expectOne('/api/auth/password-reset');
    expect(reset.request.body).toEqual({
      token: 'A'.repeat(43),
      newPassword: 'synthetic-password',
    });
    reset.flush(null, { status: 204, statusText: 'No Content' });
    await Promise.resolve();
    http.expectOne('/api/auth/session').flush({ account: { id: 'other-account' } });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Senha redefinida');
    expect(window.location.href).not.toContain('token');
    http.verify();
  });
});
