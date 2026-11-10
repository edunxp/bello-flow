import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface CardComment {
  id: string;
  author: string;
  content: string | null;
  version: string | null;
  createdAt: string;
  editedAt: string | null;
  removedAt: string | null;
  removedBy: string | null;
  canEdit: boolean;
  canModerate: boolean;
}

interface Thread {
  editable: boolean;
  comments: CardComment[];
}

type Action = 'EDIT' | 'REMOVE' | 'MODERATE';
const options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };

@Component({
  selector: 'app-card-comments',
  imports: [DatePipe],
  styles: `
    .comment-text {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    form {
      display: grid;
      gap: 0.4rem;
      margin-block: 0.75rem;
    }
    textarea {
      min-height: 4rem;
    }
  `,
  template: `
    <section aria-label="Comentários do cartão">
      @if (message()) {
        <p role="status">{{ message() }}</p>
      }
      @if (thread(); as data) {
        <ul>
          @for (comment of data.comments; track comment.id) {
            <li>
              <p>
                {{ comment.author }} ·
                <time [attr.datetime]="comment.createdAt">{{
                  comment.createdAt | date: 'dd/MM/yyyy HH:mm'
                }}</time>
                @if (comment.editedAt) {
                  ·
                  <span [title]="(comment.editedAt | date: 'dd/MM/yyyy HH:mm') ?? ''">Editado</span>
                }
              </p>
              @if (comment.removedAt) {
                <p>
                  Comentário removido
                  @if (comment.removedBy && comment.removedBy !== comment.author) {
                    por {{ comment.removedBy }}
                  }
                </p>
              } @else {
                <p class="comment-text">{{ comment.content }}</p>
                @if (pending()?.comment.id === comment.id) {
                  @if (pending()?.kind === 'EDIT') {
                    <form (submit)="submit($event, edit.value)">
                      <label [attr.for]="'comment-edit-' + comment.id">Editar comentário</label>
                      <textarea
                        [id]="'comment-edit-' + comment.id"
                        #edit
                        [value]="comment.content ?? ''"
                        required
                      ></textarea>
                      <button [disabled]="saving()">Salvar comentário</button>
                    </form>
                  } @else {
                    <p>Remover este comentário? O texto deixará de aparecer no cartão.</p>
                    @if (pending()?.kind === 'MODERATE') {
                      <form (submit)="submit($event, reason.value)">
                        <label [attr.for]="'comment-reason-' + comment.id"
                          >Justificativa de moderação</label
                        >
                        <textarea [id]="'comment-reason-' + comment.id" #reason required></textarea>
                        <button [disabled]="saving()">Confirmar moderação</button>
                      </form>
                    } @else {
                      <button type="button" [disabled]="saving()" (click)="submit($event, '')">
                        Confirmar remoção
                      </button>
                    }
                  }
                  <button type="button" [disabled]="saving()" (click)="pending.set(null)">
                    Cancelar
                  </button>
                } @else if (comment.canEdit) {
                  <button
                    type="button"
                    [disabled]="saving()"
                    (click)="pending.set({ kind: 'EDIT', comment })"
                  >
                    Editar comentário
                  </button>
                  <button
                    type="button"
                    [disabled]="saving()"
                    (click)="pending.set({ kind: 'REMOVE', comment })"
                  >
                    Remover comentário
                  </button>
                } @else if (comment.canModerate) {
                  <button
                    type="button"
                    [disabled]="saving()"
                    (click)="pending.set({ kind: 'MODERATE', comment })"
                  >
                    Moderar comentário
                  </button>
                }
              }
            </li>
          } @empty {
            <li>Nenhum comentário.</li>
          }
        </ul>
        @if (data.editable && !pending()) {
          <form (submit)="create($event, body)">
            <label [attr.for]="'comment-new-' + cardId()">Novo comentário</label>
            <textarea [id]="'comment-new-' + cardId()" #body required></textarea>
            <button [disabled]="saving()">Publicar comentário</button>
          </form>
        }
      }
    </section>
  `,
})
export class CardComments {
  readonly path = input.required<string>();
  readonly cardId = input.required<string>();
  readonly revision = input.required<number>();
  readonly thread = signal<Thread | null>(null);
  readonly pending = signal<{ kind: Action; comment: CardComment } | null>(null);
  readonly message = signal('');
  readonly saving = signal(false);
  private readonly http = inject(HttpClient);
  private readonly reload = signal(0);
  private readonly uncertain = new Map<string, string>();

  constructor() {
    effect((onCleanup) => {
      this.revision();
      this.reload();
      const request = this.http.get<Thread>(this.path(), options).subscribe({
        next: (thread) => {
          const pending = this.pending();
          if (pending) {
            const current = thread.comments.find(({ id }) => id === pending.comment.id);
            const allowed = pending.kind === 'MODERATE' ? current?.canModerate : current?.canEdit;
            if (!allowed || current?.version !== pending.comment.version) this.pending.set(null);
          }
          this.thread.set(thread);
        },
        error: () => {
          this.thread.set(null);
          this.pending.set(null);
          this.message.set('Comentários indisponíveis.');
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  async create(event: Event, body: HTMLTextAreaElement) {
    event.preventDefault();
    if (await this.write({ kind: 'CREATE', content: body.value })) body.value = '';
  }

  submit(event: Event, value: string) {
    event.preventDefault();
    const pending = this.pending();
    if (!pending) return;
    const { kind, comment } = pending;
    return this.write({
      kind,
      id: comment.id,
      version: comment.version,
      ...(kind === 'EDIT' ? { content: value } : { confirmed: true }),
      ...(kind === 'MODERATE' ? { justification: value } : {}),
    });
  }

  private async write(body: { kind: Action | 'CREATE' } & Record<string, unknown>) {
    if (!this.thread()?.editable || this.saving()) return false;
    const path = this.path();
    const key = JSON.stringify([path, body]);
    const operationId = this.uncertain.get(key) ?? crypto.randomUUID();
    this.uncertain.set(key, operationId);
    this.saving.set(true);
    this.message.set('');
    let refresh = true;
    try {
      await firstValueFrom(this.http.post(path, { ...body, operationId }, options));
      this.uncertain.delete(key);
      this.pending.set(null);
      return true;
    } catch (error) {
      if (error instanceof HttpErrorResponse && [400, 401, 403, 404, 409].includes(error.status)) {
        this.uncertain.delete(key);
        if (error.status === 400) {
          refresh = false;
          this.message.set(
            'Confira o texto. Comentários aceitam até 10.000 caracteres e justificativas até 2.000.',
          );
          return false;
        }
        if (error.status === 409 && body.kind === 'CREATE') {
          this.message.set(
            'O pedido já pode ter sido registrado. Confira os comentários atualizados.',
          );
          return true;
        }
        this.pending.set(null);
      }
      this.message.set('Não foi possível confirmar a ação. Confira os comentários atualizados.');
      return false;
    } finally {
      if (refresh) this.reload.update((value) => value + 1);
      this.saving.set(false);
    }
  }
}
