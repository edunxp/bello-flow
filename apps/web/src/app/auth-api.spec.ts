import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthApi } from './auth-api';

describe('AuthApi HTTP contract', () => {
  it('uses same-origin URLs, exact DTOs and one application header', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(AuthApi);
    const http = TestBed.inject(HttpTestingController);
    const calls: [string, string, object | null, () => Promise<unknown>][] = [
      ['GET', 'session', null, () => api.session()],
      [
        'POST',
        'login',
        { email: 'test@example.invalid', password: 'synthetic-password' },
        () => api.login('test@example.invalid', 'synthetic-password'),
      ],
      ['POST', 'logout', null, () => api.logout()],
      [
        'POST',
        'password-recovery',
        { email: 'test@example.invalid' },
        () => api.recover('test@example.invalid'),
      ],
      [
        'POST',
        'password-reset',
        { token: 'synthetic', newPassword: 'synthetic-password' },
        () => api.reset('synthetic', 'synthetic-password'),
      ],
    ];
    for (const [method, path, body, send] of calls) {
      const promise = send();
      const request = http.expectOne('/api/auth/' + path);
      expect(request.request.method).toBe(method);
      expect(request.request.body).toEqual(body);
      expect(request.request.headers.getAll('X-Bello-Flow-Request')).toEqual(['1']);
      expect(request.request.headers.has('Content-Type')).toBe(false);
      request.flush(
        path === 'login' || path === 'session' ? { account: { id: 'synthetic' } } : null,
      );
      await promise;
    }
    http.verify();
  });
});
