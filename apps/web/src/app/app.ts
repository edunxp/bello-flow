import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
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
  constructor() {
    inject(ResetToken);
    void inject(Session).restore();
    inject(Router)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event instanceof NavigationEnd) {
          document.title = 'Bello Flow — Acesso';
          setTimeout(() => document.getElementById('page-title')?.focus());
        }
      });
  }
}
