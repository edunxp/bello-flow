import { Component, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthApi } from './auth-api';
import { failureMessage } from './auth-errors';
import { Session } from './session';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  styleUrl: './auth-page.scss',
  template: `<section class="card" aria-labelledby="page-title">
    <h1 id="page-title" tabindex="-1">Seu acesso ao Bello Flow</h1>
    @switch (session.state()) {
      @case ('loading') {
        <p role="status">Consultando sessão…</p>
      }
      @case ('unavailable') {
        <p role="status">Não foi possível consultar sua sessão. Confira sua conexão.</p>
        <button (click)="session.restore()">Tentar consulta novamente</button>
      }
      @case ('anonymous') {
        <p>Entre para continuar.</p>
        <a routerLink="/login">Ir para o login</a>
      }
      @case ('authenticated') {
        <p>Sessão ativa. Os recursos de trabalho serão entregues nas próximas etapas.</p>
        <button (click)="logout()" [disabled]="busy()">{{ busy() ? 'Saindo…' : 'Sair' }}</button>
      }
    }
    <p id="logout-feedback" tabindex="-1" role="status">{{ message() }}</p>
  </section>`,
})
export class Home {
  readonly session = inject(Session);
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);
  readonly busy = signal(false);
  readonly message = signal('');
  constructor() {
    effect(() => {
      if (this.session.state() === 'anonymous') void this.router.navigateByUrl('/login');
    });
  }
  async logout() {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      await this.api.logout();
      this.session.signedOut();
      await this.router.navigateByUrl('/login');
    } catch (error) {
      this.message.set(failureMessage(error, 'logout'));
    } finally {
      this.busy.set(false);
      document.getElementById('logout-feedback')?.focus();
    }
  }
}
