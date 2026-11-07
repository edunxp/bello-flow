import { Injectable, OnDestroy, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ResetToken implements OnDestroy {
  private readonly value = signal('');
  readonly generation = signal(0);
  // Capture phase runs before the Router's location listeners read the URL.
  private readonly capture = () => {
    if (window.location.pathname !== '/reset-password' || !window.location.hash) return;
    const fragment = window.location.hash;
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
    this.value.set(match && 'AEIMQUYcgkosw048'.includes(match[1][42]) ? match[1] : '');
    this.generation.update((value) => value + 1);
  };
  constructor() {
    this.capture();
    window.addEventListener('popstate', this.capture, true);
    window.addEventListener('hashchange', this.capture, true);
  }
  read() {
    return this.value();
  }
  clear(expected = this.read()) {
    if (this.read() === expected) this.value.set('');
  }
  ngOnDestroy() {
    window.removeEventListener('popstate', this.capture, true);
    window.removeEventListener('hashchange', this.capture, true);
    this.clear();
  }
}
