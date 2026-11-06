import { Component, inject, signal, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthApi } from './auth-api';
import { failureMessage, retrySeconds, validPassword } from './auth-errors';
import { ResetToken } from './reset-token';
import { Session } from './session';

@Component({
  selector: 'app-auth-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.scss',
})
export class AuthPage implements OnDestroy {
  readonly mode = inject(ActivatedRoute).snapshot.data['mode'] as 'login' | 'recover' | 'reset';
  readonly session = inject(Session);
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);
  private readonly token = inject(ResetToken);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly done = signal(false);
  readonly remaining = signal(0);
  email = '';
  password = '';
  confirmation = '';
  private timer?: ReturnType<typeof setInterval>;
  private destroyed = false;
  get hasToken() {
    return !!this.token.read();
  }
  get title() {
    return this.mode === 'login'
      ? 'Entrar no Bello Flow'
      : this.mode === 'recover'
        ? 'Recuperar acesso'
        : 'Redefinir senha';
  }

  async submit(valid = true) {
    if (!valid) {
      this.message.set('Preencha os campos obrigatórios antes de continuar.');
      document.getElementById('form-feedback')?.focus();
      return;
    }
    if (this.busy() || this.remaining() || this.done()) return;
    this.message.set('');
    if (
      this.mode === 'reset' &&
      (!this.hasToken || !validPassword(this.password) || this.password !== this.confirmation)
    ) {
      this.message.set(
        'Use uma senha de 12 a 128 caracteres Unicode e confirme a mesma senha. Se o link estiver indisponível, solicite outro.',
      );
      return;
    }
    this.busy.set(true);
    try {
      if (this.mode === 'login') {
        const identity = await this.api.login(this.email, this.password);
        if (this.destroyed) return;
        this.session.signedIn(identity);
        await this.router.navigateByUrl('/');
      } else if (this.mode === 'recover') {
        await this.api.recover(this.email);
        if (!this.destroyed) this.done.set(true);
      } else {
        await this.api.reset(this.token.read(), this.password);
        this.token.clear();
        if (!this.destroyed) {
          this.done.set(true);
          await this.session.restore();
        }
      }
    } catch (error) {
      if (this.destroyed) return;
      this.message.set(failureMessage(error, this.mode));
      this.remaining.set(retrySeconds(error));
      if (this.remaining())
        this.timer = setInterval(() => {
          this.remaining.update((value) => value - 1);
          if (!this.remaining()) clearInterval(this.timer);
        }, 1000);
    } finally {
      this.password = '';
      this.confirmation = '';
      if (!this.destroyed) {
        this.busy.set(false);
        document.getElementById('form-feedback')?.focus();
      }
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    clearInterval(this.timer);
    this.password = '';
    this.confirmation = '';
    if (this.mode === 'reset') this.token.clear();
  }
}
