import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Session } from './session';

export interface Label {
  id: string;
  name: string;
  color: string | null;
}
interface Catalog {
  editable: boolean;
  labels: Label[];
}
const options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };

@Component({
  selector: 'app-workspace-labels',
  imports: [RouterLink],
  styleUrl: './auth-page.scss',
  template: `
    <section class="card" aria-labelledby="page-title">
      <h1 id="page-title">Etiquetas do Workspace</h1>
      <p><a [routerLink]="['/workspaces', workspaceId()]">Voltar ao Workspace</a></p>
      @if (session.state() === 'anonymous') {
        <a routerLink="/login">Ir para o login</a>
      }
      @if (message()) {
        <p role="status">{{ message() }}</p>
      }
      @if (catalog(); as data) {
        <ul aria-label="Catálogo de etiquetas">
          @for (label of data.labels; track label.id) {
            <li>
              <strong>{{ label.name }}</strong>
              @if (label.color) {
                <span> · {{ label.color }}</span>
              }
              @if (data.editable && !pending()) {
                <details>
                  <summary>Editar {{ label.name }}</summary>
                  <form (submit)="save($event, name.value, color.value, label.id)">
                    <label [attr.for]="'name-' + label.id">Novo nome</label>
                    <input [id]="'name-' + label.id" #name [value]="label.name" required />
                    <label [attr.for]="'color-' + label.id">Nova cor (opcional)</label>
                    <input
                      [id]="'color-' + label.id"
                      #color
                      [value]="label.color ?? ''"
                      placeholder="#RRGGBB"
                    />
                    <button [disabled]="saving()">Salvar etiqueta</button>
                  </form>
                </details>
                <button type="button" [disabled]="saving()" (click)="pending.set(label)">
                  Excluir {{ label.name }}
                </button>
              }
            </li>
          } @empty {
            <li>Nenhuma etiqueta cadastrada.</li>
          }
        </ul>
        @if (pending(); as label) {
          <p>
            Excluir {{ label.name }} do catálogo? Ela será removida dos cartões e o histórico será
            preservado.
          </p>
          <button type="button" [disabled]="saving()" (click)="remove(label)">
            Confirmar exclusão
          </button>
          <button type="button" [disabled]="saving()" (click)="pending.set(null)">Cancelar</button>
        } @else if (data.editable) {
          <form (submit)="save($event, name.value, color.value)">
            <label for="new-label-name">Nome da etiqueta</label>
            <input id="new-label-name" #name required />
            <label for="new-label-color">Cor da etiqueta (opcional)</label>
            <input id="new-label-color" #color placeholder="#RRGGBB" />
            <button [disabled]="saving()">Criar etiqueta</button>
          </form>
        }
      }
    </section>
  `,
})
export class WorkspaceLabels {
  readonly session = inject(Session);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap, { requireSync: true });
  private readonly http = inject(HttpClient);
  readonly catalog = signal<Catalog | null>(null);
  readonly pending = signal<Label | null>(null);
  readonly message = signal('');
  readonly saving = signal(false);
  private readonly reload = signal(0);
  private readonly uncertain = new Map<string, string>();

  constructor() {
    effect((onCleanup) => {
      const path = this.path();
      const identity = this.session.identity();
      const reload = this.reload();
      this.catalog.set(null);
      this.pending.set(null);
      if (reload === 0) this.message.set('');
      if (!identity) return;
      const request = this.http.get<Catalog>(path, options).subscribe({
        next: (catalog) => this.catalog.set(catalog),
        error: () => this.message.set('Catálogo indisponível.'),
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  workspaceId() {
    return this.params().get('workspaceId');
  }

  private path() {
    return '/api/workspaces/' + this.workspaceId() + '/labels';
  }

  save(event: Event, name: string, color: string, labelId?: string) {
    event.preventDefault();
    const body = { name: name.trim(), color: color.trim() || null };
    if (labelId) return this.mutate('PATCH', '/' + labelId, body);
    return this.mutate('POST', '', body);
  }

  remove(label: Label) {
    return this.mutate('POST', '/' + label.id + '/delete', {
      name: label.name,
      color: label.color,
      confirmed: true,
    });
  }

  private async mutate(method: 'POST' | 'PATCH', suffix: string, body: object) {
    if (!this.catalog()?.editable || this.saving()) return;
    const path = this.path();
    const identity = this.session.identity();
    const current = () => path === this.path() && identity === this.session.identity();
    const key = JSON.stringify([identity?.account.id, path, method, suffix, body]);
    const operationId = this.uncertain.get(key) ?? crypto.randomUUID();
    this.uncertain.set(key, operationId);
    let refresh = true;
    this.saving.set(true);
    this.message.set('');
    try {
      await firstValueFrom(
        this.http.request(method, path + suffix, {
          body: { ...body, operationId },
          ...options,
        }),
      );
      this.uncertain.delete(key);
      if (current()) this.message.set('Catálogo atualizado.');
    } catch (error) {
      if (error instanceof HttpErrorResponse && [400, 401, 403, 404, 409].includes(error.status))
        this.uncertain.delete(key);
      if (!current()) return;
      if (error instanceof HttpErrorResponse && error.status === 400) {
        refresh = false;
        this.message.set(
          'Confira o nome e a cor. Use até 50 caracteres e uma cor no formato #RRGGBB.',
        );
        return;
      }
      this.message.set(
        error instanceof HttpErrorResponse && error.status === 409
          ? 'O pedido já pode ter sido registrado, o nome está em uso ou a etiqueta mudou. Confira o catálogo.'
          : 'Não foi possível confirmar a alteração. Confira o catálogo atualizado.',
      );
    } finally {
      if (current() && refresh) this.reload.update((value) => value + 1);
      this.saving.set(false);
    }
  }
}
