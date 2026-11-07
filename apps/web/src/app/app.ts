import { Component, inject } from '@angular/core';
import { NavigationEnd, NavigationStart, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Session } from './session';
import { ResetToken } from './reset-token';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  skipToContent(event: Event) {
    event.preventDefault();
    document.getElementById('main-content')?.focus();
  }
  constructor() {
    inject(ResetToken);
    const session = inject(Session);
    void session.restore();
    inject(Router)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (
          event instanceof NavigationStart &&
          event.id > 1 &&
          !['/forgot-password', '/reset-password'].includes(event.url.split(/[?#]/)[0])
        ) {
          void session.restore();
        }
        if (event instanceof NavigationEnd) {
          document.title = 'Bello Flow — Acesso';
          setTimeout(() => document.getElementById('page-title')?.focus());
        }
      });
  }
}
