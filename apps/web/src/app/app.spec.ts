import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { Home } from './home';

describe('App shell', () => {
  it('restores the session and renders a keyboard-accessible shell', async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([{ path: '', component: Home }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    const fixture = TestBed.createComponent(App);
    TestBed.inject(HttpTestingController)
      .expectOne('/api/auth/session')
      .flush({ account: { id: 'synthetic' } });
    await TestBed.inject(Router).navigateByUrl('/');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Bello Flow');
    expect(fixture.nativeElement.querySelector('.skip-link')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    TestBed.inject(HttpTestingController).verify();
  });
});
