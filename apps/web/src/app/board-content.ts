import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface Card {
  id: string;
  title: string;
  description: string | null;
}
interface List {
  id: string;
  name: string;
  cards: Card[];
}
interface Content {
  editable: boolean;
  lists: List[];
}

@Component({
  selector: 'app-board-content',
  styles: `
    section {
      margin-block: 1.25rem;
    }
    form {
      display: grid;
      gap: 0.4rem;
      margin-block: 0.75rem;
    }
    textarea {
      min-height: 5rem;
    }
    .description {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    h3,
    h4 {
      overflow-wrap: anywhere;
    }
  `,
  template: `
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
    @if (content(); as board) {
      @for (list of board.lists; track list.id) {
        <section [attr.aria-label]="list.name">
          <h3>{{ list.name }}</h3>
          @if (board.editable) {
            <details>
              <summary>Renomear lista</summary>
              <form (submit)="save($event, '/' + list.id, { name: rename.value }, false)">
                <label [attr.for]="'name-' + list.id">Novo nome da lista</label>
                <input [id]="'name-' + list.id" #rename [value]="list.name" required />
                <button [disabled]="saving()">Salvar nome</button>
              </form>
            </details>
          }
          @for (card of list.cards; track card.id) {
            <article>
              <h4>{{ card.title }}</h4>
              <p class="description">{{ card.description }}</p>
              @if (board.editable) {
                <details>
                  <summary>Editar cartão</summary>
                  <form
                    (submit)="
                      save(
                        $event,
                        '/' + list.id + '/cards/' + card.id,
                        cardChanges(card, title.value, description.value),
                        false
                      )
                    "
                  >
                    <label [attr.for]="'title-' + card.id">Título do cartão</label>
                    <input [id]="'title-' + card.id" #title [value]="card.title" required />
                    <label [attr.for]="'description-' + card.id">Descrição do cartão</label>
                    <textarea
                      [id]="'description-' + card.id"
                      #description
                      [value]="card.description ?? ''"
                    ></textarea>
                    <button [disabled]="saving()">Salvar cartão</button>
                  </form>
                </details>
              }
            </article>
          }
          @if (board.editable) {
            <form
              (submit)="
                save(
                  $event,
                  '/' + list.id + '/cards',
                  { title: newTitle.value, description: newDescription.value },
                  true
                )
              "
            >
              <label [attr.for]="'new-title-' + list.id">Título do novo cartão</label>
              <input [id]="'new-title-' + list.id" #newTitle required />
              <label [attr.for]="'new-description-' + list.id">Descrição do novo cartão</label>
              <textarea [id]="'new-description-' + list.id" #newDescription></textarea>
              <button [disabled]="saving()">Criar cartão</button>
            </form>
          }
        </section>
      } @empty {
        <p>Este quadro ainda não tem listas.</p>
      }
      @if (board.editable) {
        <form (submit)="save($event, '', { name: name.value }, true)">
          <label for="new-list-name">Nome da nova lista</label>
          <input id="new-list-name" #name required />
          <button [disabled]="saving()">Criar lista</button>
        </form>
      }
    }
  `,
})
export class BoardContent {
  readonly path = input.required<string>();
  readonly accountId = input.required<string>();
  readonly content = signal<Content | null>(null);
  readonly message = signal('');
  readonly saving = signal(false);
  private readonly http = inject(HttpClient);
  private readonly options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };
  private readonly reload = signal(0);

  constructor() {
    effect((onCleanup) => {
      this.reload();
      const request = this.http.get<Content>(this.path(), this.options).subscribe({
        next: (content) => this.content.set(content),
        error: () => {
          this.content.set(null);
          this.message.set('Conteúdo do quadro indisponível.');
        },
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  cardChanges(card: Card, title: string, description: string) {
    return {
      title: title.trim() === card.title.replace(/[\r\n]/gu, '').trim() ? undefined : title,
      description:
        description === (card.description ?? '').replace(/\r\n?/gu, '\n') ? undefined : description,
    };
  }

  async save(
    event: Event,
    suffix: string,
    fields: Record<string, string | undefined>,
    create: boolean,
  ) {
    event.preventDefault();
    if (this.saving() || Object.values(fields).every((value) => value === undefined)) return;
    const form = event.currentTarget as HTMLFormElement;
    const path = this.path() + suffix;
    const key = 'bello.pending-create:' + this.accountId() + ':' + path;
    let operationId: string | undefined;
    this.saving.set(true);
    this.message.set('');
    try {
      if (create) {
        operationId = sessionStorage.getItem(key) ?? crypto.randomUUID();
        sessionStorage.setItem(key, operationId);
      }
      const request = create
        ? this.http.post(path, { ...fields, operationId }, this.options)
        : this.http.patch(path, fields, this.options);
      await firstValueFrom(request);
      if (create) {
        if (sessionStorage.getItem(key) === operationId) sessionStorage.removeItem(key);
        form.reset();
      }
      this.reload.update((value) => value + 1);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409 && create) {
        if (sessionStorage.getItem(key) === operationId) sessionStorage.removeItem(key);
        this.reload.update((value) => value + 1);
        this.message.set(
          'Uma criação anterior já foi concluída. Confira o quadro antes de criar outro item.',
        );
      } else if (error instanceof HttpErrorResponse && error.status === 400) {
        this.message.set(
          'Confira os campos. O nome aceita até 100 caracteres, o título até 200 e a descrição até 20.000.',
        );
      } else if (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status)) {
        this.reload.update((value) => value + 1);
        this.message.set('A operação está indisponível para esta conta.');
      } else {
        if (!create) {
          this.content.set(null);
          this.reload.update((value) => value + 1);
        }
        this.message.set(
          create && operationId
            ? 'Não foi possível confirmar a criação. Repita com os mesmos dados.'
            : 'Não foi possível confirmar a alteração. Confira o conteúdo atualizado do quadro.',
        );
      }
    } finally {
      this.saving.set(false);
    }
  }
}
