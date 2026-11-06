import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { AuthApi, Identity } from './auth-api';

export type SessionState = 'loading' | 'authenticated' | 'anonymous' | 'unavailable';
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(AuthApi);
  readonly state = signal<SessionState>('loading');
  readonly identity = signal<Identity | null>(null);
  private revision = 0;
  async restore(): Promise<void> {
    const revision = ++this.revision;
    this.state.set('loading');
    try {
      const identity = await this.api.session();
      if (revision !== this.revision) return;
      this.identity.set(identity);
      this.state.set('authenticated');
    } catch (error) {
      if (revision !== this.revision) return;
      this.identity.set(null);
      this.state.set(
        error instanceof HttpErrorResponse && error.status === 401 ? 'anonymous' : 'unavailable',
      );
    }
  }
  signedIn(identity: Identity) {
    this.revision++;
    this.identity.set(identity);
    this.state.set('authenticated');
  }
  signedOut() {
    this.revision++;
    this.identity.set(null);
    this.state.set('anonymous');
  }
}
