import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Home } from './home';
import { Session } from './session';
import { AuthApi } from './auth-api';
describe('Authenticated landing', () => {
  function setup() {
    const api = {
      logout: vi.fn().mockResolvedValue(undefined),
      session: vi.fn().mockResolvedValue({ account: { id: 'synthetic' } }),
    };
    TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([]), { provide: AuthApi, useValue: api }],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Home);
    return { fixture, page: fixture.componentInstance, session: TestBed.inject(Session), api };
  }
  it('renders loading, unavailable, anonymous and authenticated states', async () => {
    const { fixture, session, api } = setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Consultando');
    api.session.mockRejectedValue(new Error());
    await session.restore();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Não foi possível');
    api.session.mockResolvedValue({ account: { id: 'synthetic' } });
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sessão ativa');
    session.signedOut();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Entre para continuar');
  });
  it('only confirms logout after the server responds', async () => {
    const { page, session, api } = setup();
    session.signedIn({ account: { id: 'synthetic' } });
    let resolve!: () => void;
    api.logout.mockReturnValue(
      new Promise<void>((yes) => {
        resolve = yes;
      }),
    );
    const pending = page.logout();
    await page.logout();
    expect(api.logout).toHaveBeenCalledOnce();
    expect(session.state()).toBe('authenticated');
    resolve();
    await pending;
    expect(session.state()).toBe('anonymous');
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/login');
  });
  it('preserves session state on uncertain logout', async () => {
    const { fixture, page, session, api } = setup();
    session.signedIn({ account: { id: 'synthetic' } });
    api.logout.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('button').click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(session.state()).toBe('authenticated');
    expect(page.message()).toContain('pendente');
  });
});
