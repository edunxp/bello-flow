import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';

export interface Identity {
  account: { id: string };
}

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly headers = new HttpHeaders({ 'X-Bello-Flow-Request': '1' });
  private call<T>(method: string, path: string, body?: object): Promise<T> {
    return firstValueFrom(
      this.http
        .request<T>(method, '/api/auth/' + path, {
          headers: this.headers,
          body,
          timeout: 15000,
        })
        .pipe(timeout(16000)),
    );
  }
  session() {
    return this.call<Identity>('GET', 'session');
  }
  login(email: string, password: string) {
    return this.call<Identity>('POST', 'login', { email, password });
  }
  logout() {
    return this.call<void>('POST', 'logout');
  }
  recover(email: string) {
    return this.call<void>('POST', 'password-recovery', { email });
  }
  reset(token: string, newPassword: string) {
    return this.call<void>('POST', 'password-reset', { token, newPassword });
  }
}
