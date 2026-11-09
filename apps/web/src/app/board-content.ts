import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY, exhaustMap, firstValueFrom, throwError, timer } from 'rxjs';

interface Card {
  id: string;
  title: string;
  positionRevision: number;
  description: string | null;
}
interface List {
  id: string;
  name: string;
  positionRevision: number;
  cardOrderRevision: number;
  cards: Card[];
}
interface Content {
  editable: boolean;
  orderRevision: number;
  syncRevision: number;
  lists: List[];
}

interface DragItem {
  kind: 'LIST' | 'CARD';
  itemId: string;
  itemRevision: number;
  sourceId: string;
  sourceRevision: number;
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
    .drop-zone {
      padding: 0.75rem;
      border: 1px dashed currentColor;
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
            <button
              type="button"
              draggable="true"
              (dragstart)="startDrag($event, list)"
              (dragend)="drag.set(null)"
              (dragover)="allowDrop($event, 'LIST')"
              (drop)="drop($event, 'LIST', null, list.id)"
            >
              Arrastar lista {{ list.name }}
            </button>
            <button
              type="button"
              [disabled]="$first || saving()"
              (click)="moveStep(list, undefined, -1)"
            >
              Subir lista
            </button>
            <button
              type="button"
              [disabled]="$last || saving()"
              (click)="moveStep(list, undefined, 1)"
            >
              Descer lista
            </button>
          }
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
                <button
                  type="button"
                  draggable="true"
                  (dragstart)="startDrag($event, list, card)"
                  (dragend)="drag.set(null)"
                  (dragover)="allowDrop($event, 'CARD')"
                  (drop)="drop($event, 'CARD', list, card.id)"
                >
                  Arrastar cartão {{ card.title }}
                </button>
                <button
                  type="button"
                  [disabled]="$first || saving()"
                  (click)="moveStep(list, card, -1)"
                >
                  Subir cartão
                </button>
                <button
                  type="button"
                  [disabled]="$last || saving()"
                  (click)="moveStep(list, card, 1)"
                >
                  Descer cartão
                </button>
                @if (board.lists.length > 1) {
                  <label [attr.for]="'move-' + card.id">Mover cartão para</label>
                  <select [id]="'move-' + card.id" #destination>
                    @for (other of board.lists; track other.id) {
                      @if (other.id !== list.id) {
                        <option [value]="other.id">{{ other.name }}</option>
                      }
                    }
                  </select>
                  <button
                    type="button"
                    [disabled]="saving()"
                    (click)="moveToList(list, card, destination.value)"
                  >
                    Mover cartão
                  </button>
                }
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
            @if (drag()?.kind === 'CARD') {
              <div
                class="drop-zone"
                (dragover)="allowDrop($event, 'CARD')"
                (drop)="drop($event, 'CARD', list, null)"
              >
                Soltar no fim de {{ list.name }}
              </div>
            }
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
        @if (drag()?.kind === 'LIST') {
          <div
            class="drop-zone"
            (dragover)="allowDrop($event, 'LIST')"
            (drop)="drop($event, 'LIST', null, null)"
          >
            Soltar no fim do quadro
          </div>
        }
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
  readonly drag = signal<DragItem | null>(null);
  private readonly http = inject(HttpClient);
  private readonly options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };
  private readonly reload = signal(0);
  private accessLost = false;

  constructor() {
    effect((onCleanup) => {
      this.reload();
      if (this.accessLost) return;
      const request = this.http.get<Content>(this.path(), this.options).subscribe({
        next: (content) => {
          if (!this.accessLost) this.content.set(content);
        },
        error: () => {
          this.content.set(null);
          this.message.set('Conteúdo do quadro indisponível.');
        },
      });
      onCleanup(() => request.unsubscribe());
    });
    effect((onCleanup) => {
      const path = this.path();
      const poll = timer(5000, 5000)
        .pipe(
          exhaustMap(() =>
            this.http.get<{ syncRevision: number }>(path + '/revision', this.options).pipe(
              catchError((error: unknown) => {
                if (error instanceof HttpErrorResponse && [401, 403, 404].includes(error.status)) {
                  this.accessLost = true;
                  this.content.set(null);
                  this.message.set('Conteúdo do quadro indisponível.');
                  return throwError(() => error);
                }
                return EMPTY;
              }),
            ),
          ),
        )
        .pipe(catchError(() => EMPTY))
        .subscribe(({ syncRevision }) => {
          if (this.content()?.syncRevision !== syncRevision)
            this.reload.update((value) => value + 1);
        });
      onCleanup(() => poll.unsubscribe());
    });
  }

  private moving(list: List, card?: Card): DragItem {
    const board = this.content()!;
    return {
      kind: card ? 'CARD' : 'LIST',
      itemId: card?.id ?? list.id,
      itemRevision: card?.positionRevision ?? list.positionRevision,
      sourceId: card ? list.id : this.path().split('/').at(-2)!,
      sourceRevision: card ? list.cardOrderRevision : board.orderRevision,
    };
  }

  startDrag(event: DragEvent, list: List, card?: Card) {
    if (this.saving()) {
      event.preventDefault();
      return;
    }
    this.drag.set(this.moving(list, card));
    event.dataTransfer?.setData('text/plain', card?.id ?? list.id);
  }

  allowDrop(event: DragEvent, kind: DragItem['kind']) {
    if (this.drag()?.kind === kind) event.preventDefault();
  }

  drop(event: DragEvent, kind: DragItem['kind'], list: List | null, before: string | null) {
    event.preventDefault();
    const item = this.drag();
    this.drag.set(null);
    if (item?.kind === kind && item.itemId !== before) void this.sendMove(item, list, before);
  }

  moveStep(list: List, card: Card | undefined, offset: number) {
    const item = this.moving(list, card);
    const siblings = card ? list.cards : this.content()!.lists;
    const index = siblings.findIndex(({ id }) => id === item.itemId);
    const before = siblings[index + (offset > 0 ? 2 : -1)]?.id ?? null;
    return this.sendMove(item, card ? list : null, before);
  }

  moveToList(list: List, card: Card, destination: string) {
    const target = this.content()!.lists.find(({ id }) => id === destination);
    if (target) return this.sendMove(this.moving(list, card), target, null);
    return;
  }

  private async sendMove(item: DragItem, list: List | null, before: string | null) {
    const board = this.content();
    if (!board?.editable || this.saving()) return;
    const siblings = list?.cards ?? board.lists;
    const items = siblings.filter(({ id }) => id !== item.itemId);
    const index = before === null ? items.length : items.findIndex(({ id }) => id === before);
    const destinationId = list?.id ?? item.sourceId;
    if (
      index < 0 ||
      (destinationId === item.sourceId &&
        index === siblings.findIndex(({ id }) => id === item.itemId))
    )
      return;

    this.saving.set(true);
    this.message.set('');
    try {
      await firstValueFrom(
        this.http.post(
          this.path() + '/move',
          {
            ...item,
            destinationId,
            destinationRevision: list?.cardOrderRevision ?? board.orderRevision,
            leftId: items[index - 1]?.id ?? null,
            rightId: items[index]?.id ?? null,
            operationId: crypto.randomUUID(),
          },
          this.options,
        ),
      );
    } catch {
      this.message.set('Não foi possível confirmar o movimento. Confira a ordem atualizada.');
    } finally {
      this.reload.update((value) => value + 1);
      this.saving.set(false);
    }
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
