import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ResetToken {
  private value = '';
  constructor() {
    // Capture before router activation; never put the fragment in router state.
    if (window.location.pathname === '/reset-password') {
      const fragment = window.location.hash;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
      if (match && 'AEIMQUYcgkosw048'.includes(match[1][42])) this.value = match[1];
    }
  }
  read() {
    return this.value;
  }
  clear() {
    this.value = '';
  }
}
