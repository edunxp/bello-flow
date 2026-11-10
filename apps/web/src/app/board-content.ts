import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { catchError, EMPTY, exhaustMap, firstValueFrom, throwError, timer } from 'rxjs';

import { backgroundHeaders, BOARD_REALTIME } from './board-realtime';
import { CardComments } from './card-comments';
import type { Label } from './workspace-labels';

interface Assignee {
  accountId: string;
  email: string;
}

interface Card {
  id: string;
  title: string;
  positionRevision: number;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completedById: string | null;
  overdue: boolean;
  assignees?: Assignee[];
  labels?: Label[];
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
  eligibleAssignees?: Assignee[];
  availableLabels?: Label[];
  orderRevision: number;
  syncRevision: number;
  today: string;
  timeZone: string;
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
  imports: [CardComments],
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
    .label-color {
      display: inline-block;
      width: 1em;
      height: 1em;
      border: 1px solid currentColor;
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
              <p>
                @if (card.completedAt) {
                  Concluído em {{ completionTime(card.completedAt, board.timeZone) }}
                  @if (card.completedById === accountId()) {
                    por você
                  }
                } @else if (card.overdue) {
                  Pendente · Atrasado
                } @else {
                  Pendente
                }
              </p>
              @if (card.startDate) {
                <p>
                  Início: <time [attr.datetime]="card.startDate">{{ card.startDate }}</time>
                </p>
              }
              @if (card.dueDate) {
                <p>
                  Vencimento: <time [attr.datetime]="card.dueDate">{{ card.dueDate }}</time> ({{
                    board.timeZone
                  }})
                </p>
              }
              <button
                type="button"
                [attr.aria-expanded]="commentsCard() === card.id"
                (click)="commentsCard.set(commentsCard() === card.id ? null : card.id)"
              >
                Comentários
              </button>
              @if (commentsCard() === card.id) {
                <app-card-comments
                  [path]="path() + '/' + list.id + '/cards/' + card.id + '/comments'"
                  [cardId]="card.id"
                  [revision]="board.syncRevision"
                />
              }
              <h5>Etiquetas</h5>
              <ul>
                @for (label of card.labels ?? []; track label.id) {
                  <li>
                    @if (label.color) {
                      <span
                        class="label-color"
                        [style.backgroundColor]="label.color"
                        aria-hidden="true"
                      ></span>
                    }
                    {{ label.name }}
                    @if (board.editable) {
                      <button
                        type="button"
                        [disabled]="saving()"
                        [attr.aria-label]="'Remover etiqueta ' + label.name"
                        (click)="changeLabel(list, card, label.id, false)"
                      >
                        Remover
                      </button>
                    }
                  </li>
                } @empty {
                  <li>Sem etiquetas.</li>
                }
              </ul>
              @if (board.editable && board.availableLabels?.length) {
                <form (submit)="applyLabel($event, list, card, labelChoice.value)">
                  <label [attr.for]="'label-' + card.id">Adicionar etiqueta</label>
                  <select [id]="'label-' + card.id" #labelChoice required>
                    <option value="">Escolher etiqueta</option>
                    @for (label of board.availableLabels; track label.id) {
                      @if (!hasLabel(card, label.id)) {
                        <option [value]="label.id">{{ label.name }}</option>
                      }
                    }
                  </select>
                  <button [disabled]="saving()">Aplicar etiqueta</button>
                </form>
              }
              <h5>Responsáveis</h5>
              <ul>
                @for (person of card.assignees ?? []; track person.accountId) {
                  <li>
                    {{ person.email }}
                    @if (board.editable) {
                      <button
                        type="button"
                        [disabled]="saving()"
                        [attr.aria-label]="'Remover responsável ' + person.email"
                        (click)="changeAssignee(list, card, person.accountId, false)"
                      >
                        Remover
                      </button>
                    }
                  </li>
                } @empty {
                  <li>Sem responsáveis.</li>
                }
              </ul>
              @if (board.editable && board.eligibleAssignees?.length) {
                <form (submit)="addAssignee($event, list, card, candidate.value)">
                  <label [attr.for]="'assignee-' + card.id">Adicionar responsável</label>
                  <select [id]="'assignee-' + card.id" #candidate required>
                    <option value="">Escolher participante</option>
                    @for (person of board.eligibleAssignees; track person.accountId) {
                      @if (!hasAssignee(card, person.accountId)) {
                        <option [value]="person.accountId">{{ person.email }}</option>
                      }
                    }
                  </select>
                  <button [disabled]="saving()">Atribuir</button>
                </form>
              }
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
                <button
                  type="button"
                  [disabled]="saving()"
                  (click)="updateSchedule(list, card, { completed: !card.completedAt })"
                >
                  {{ card.completedAt ? 'Reabrir cartão' : 'Concluir cartão' }}
                </button>
                <details>
                  <summary>Editar datas</summary>
                  <form (submit)="saveDates($event, list, card, start.value, due.value)">
                    <label [attr.for]="'start-' + card.id">Data de início</label>
                    <input
                      type="date"
                      [id]="'start-' + card.id"
                      #start
                      [value]="card.startDate ?? ''"
                      max="9999-12-31"
                    />
                    <label [attr.for]="'due-' + card.id">Data de vencimento</label>
                    <input
                      type="date"
                      [id]="'due-' + card.id"
                      #due
                      [value]="card.dueDate ?? ''"
                      max="9999-12-31"
                    />
                    <button [disabled]="saving()">Salvar datas</button>
                  </form>
                </details>
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
  readonly revoked = output<void>();
  readonly content = signal<Content | null>(null);
  readonly message = signal('');
  readonly saving = signal(false);
  readonly commentsCard = signal<string | null>(null);
  readonly drag = signal<DragItem | null>(null);
  private readonly http = inject(HttpClient);
  private readonly connectRealtime = inject(BOARD_REALTIME);
  private readonly options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };
  private readonly readOptions = { ...this.options, headers: backgroundHeaders };
  private readonly reload = signal(0);
  private accessLost = false;

  constructor() {
    effect((onCleanup) => {
      this.reload();
      if (this.accessLost) return;
      const request = this.http.get<Content>(this.path(), this.readOptions).subscribe({
        next: (content) => {
          if (!this.accessLost) this.content.set(content);
        },
        error: (error: unknown) => {
          this.rejectAccess(error);
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
            this.http
              .get<{ syncRevision: number; today: string; timeZone: string }>(
                path + '/revision',
                this.readOptions,
              )
              .pipe(
                catchError((error: unknown) => {
                  if (this.rejectAccess(error)) return throwError(() => error);
                  return EMPTY;
                }),
              ),
          ),
        )
        .pipe(catchError(() => EMPTY))
        .subscribe(({ syncRevision, today, timeZone }) => {
          const current = this.content();
          if (
            current?.syncRevision !== syncRevision ||
            current?.today !== today ||
            current?.timeZone !== timeZone
          )
            this.reload.update((value) => value + 1);
        });
      onCleanup(() => poll.unsubscribe());
    });
    effect((onCleanup) => {
      const path = this.path();
      const stop = this.connectRealtime(
        path,
        (revision) => {
          if (!this.accessLost && revision > (this.content()?.syncRevision ?? -1))
            this.reload.update((value) => value + 1);
        },
        () => this.clearAccess(),
      );
      onCleanup(stop);
    });
  }

  private rejectAccess(error: unknown) {
    if (!(error instanceof HttpErrorResponse) || ![401, 403, 404].includes(error.status))
      return false;
    this.clearAccess();
    return true;
  }

  private clearAccess() {
    if (this.accessLost) return;
    this.accessLost = true;
    this.content.set(null);
    this.message.set('Conteúdo do quadro indisponível.');
    this.revoked.emit();
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

  hasLabel(card: Card, labelId: string) {
    return card.labels?.some((label) => label.id === labelId) ?? false;
  }

  applyLabel(event: Event, list: List, card: Card, labelId: string) {
    event.preventDefault();
    if (labelId) return this.changeLabel(list, card, labelId, true);
    return;
  }

  async changeLabel(list: List, card: Card, labelId: string, applied: boolean) {
    if (!this.content()?.editable || this.saving()) return;
    this.saving.set(true);
    this.message.set('');
    try {
      await firstValueFrom(
        this.http.post(
          this.path() + '/' + list.id + '/cards/' + card.id + '/labels',
          { labelId, applied, operationId: crypto.randomUUID() },
          this.options,
        ),
      );
    } catch {
      this.message.set('Não foi possível confirmar a alteração. Confira as etiquetas atualizadas.');
    } finally {
      this.reload.update((value) => value + 1);
      this.saving.set(false);
    }
  }

  hasAssignee(card: Card, accountId: string) {
    return card.assignees?.some((person) => person.accountId === accountId) ?? false;
  }

  addAssignee(event: Event, list: List, card: Card, accountId: string) {
    event.preventDefault();
    if (accountId) return this.changeAssignee(list, card, accountId, true);
    return;
  }

  async changeAssignee(list: List, card: Card, accountId: string, assigned: boolean) {
    if (!this.content()?.editable || this.saving()) return;
    this.saving.set(true);
    this.message.set('');
    try {
      await firstValueFrom(
        this.http.post(
          this.path() + '/' + list.id + '/cards/' + card.id + '/assignees',
          { accountId, assigned, operationId: crypto.randomUUID() },
          this.options,
        ),
      );
    } catch {
      this.message.set(
        'Não foi possível confirmar a atribuição. Confira os responsáveis atualizados.',
      );
    } finally {
      this.reload.update((value) => value + 1);
      this.saving.set(false);
    }
  }

  completionTime(instant: string, timeZone: string) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(instant));
  }

  saveDates(event: Event, list: List, card: Card, start: string, due: string) {
    event.preventDefault();
    const startDate = start || null;
    const dueDate = due || null;
    if (startDate && dueDate && dueDate < startDate) {
      this.message.set('A data de vencimento deve ser igual ou posterior à data de início.');
      return;
    }
    if (startDate === card.startDate && dueDate === card.dueDate) return;
    return this.updateSchedule(list, card, { startDate, dueDate });
  }

  async updateSchedule(
    list: List,
    card: Card,
    change: { completed: boolean } | { startDate: string | null; dueDate: string | null },
  ) {
    if (!this.content()?.editable || this.saving()) return;
    this.saving.set(true);
    this.message.set('');
    try {
      await firstValueFrom(
        this.http.post(
          this.path() + '/' + list.id + '/cards/' + card.id + '/schedule',
          { ...change, operationId: crypto.randomUUID() },
          this.options,
        ),
      );
    } catch (error) {
      this.message.set(
        error instanceof HttpErrorResponse && error.status === 400
          ? 'Confira as datas informadas.'
          : 'Não foi possível confirmar a alteração. Confira o estado atualizado do cartão.',
      );
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
