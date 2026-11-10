import { HttpClient } from '@angular/common/http';
import { JsonPipe } from '@angular/common';
import { Component, computed, effect, inject, Injector, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface HistoryEvent {
  restricted?: boolean;
  id?: string;
  actorId?: string;
  boardId?: string;
  origin?: string;
  context?: unknown;
  correlationId?: string;
  counterpart?: { boardName: string; listId: string };
  occurredAt: string;
  operation?: string;
  author?: string;
  actorAccountId?: string;
  boardName?: string;
  listId?: string;
  cardId?: string;
  entityType?: string;
  entityId?: string;
  result?: string;
  beforeData?: unknown;
  afterData?: unknown;
}

type Filters = Record<string, string | number>;
type Page = { events: HistoryEvent[]; next: Filters | null };

function reorderKey(event: HistoryEvent) {
  if (
    event.operation !== 'LIST_REORDERED' &&
    !(event.operation === 'CARD_MOVED' && event.counterpart?.listId === event.listId)
  )
    return null;
  return JSON.stringify([
    event.operation,
    event.boardId,
    event.actorId,
    event.listId,
    event.cardId,
  ]);
}

@Component({
  selector: 'app-history-panel',
  imports: [JsonPipe],
  template: `
    <details #disclosure (toggle)="toggle(disclosure.open)">
      <summary>{{ title() }}</summary>
      @if (open()) {
        <form (submit)="search($event)">
          <label>Operação <input name="operation" /></label>
          @if (area(); as scope) {
            <input type="hidden" name="area" [value]="scope" />
            <label>Desde (UTC) <input name="from" placeholder="AAAA-MM-DDT00:00:00Z" /></label>
            <label>Até (UTC) <input name="until" placeholder="AAAA-MM-DDT00:00:00Z" /></label>
            <label>Tipo de entidade <input name="entityType" /></label>
            <label>Identificador da entidade <input name="entityId" /></label>
            <label>Resultado <input name="result" /></label>
            <label>Identificador do ator <input name="actor" /></label>
          }
          <button [disabled]="busy()">Consultar</button>
        </form>
        @if (message()) {
          <p role="status">{{ message() }}</p>
        }
        <ol>
          @for (entry of entries(); track $index) {
            @let event = entry.event;
            <li>
              <time [attr.datetime]="event.occurredAt">{{ event.occurredAt }}</time>
              @if (event.restricted) {
                <span>Atividade histórica restrita</span>
              } @else {
                <span>{{ event.operation }} {{ event.result }}</span>
                @if (entry.count > 1) {
                  <span>({{ entry.count }} atividades)</span>
                }
                <span>{{ event.author ?? event.actorAccountId }}</span>
                <span>{{ event.boardName }} {{ event.entityType }} {{ event.entityId }}</span>
                <span>{{ event.listId }} {{ event.cardId }}</span>
                @if (event.counterpart; as other) {
                  <span>{{ other.boardName }} {{ other.listId }}</span>
                }
                @if (event.context) {
                  <p>
                    Evento {{ event.id }} · Origem {{ event.origin }} · Correlação
                    {{ event.correlationId }}
                  </p>
                  <pre>{{ event.context | json }}</pre>
                }
                @if (event.beforeData || event.afterData) {
                  <details>
                    <summary>Valores auditados</summary>
                    <pre>{{ event.beforeData | json }} → {{ event.afterData | json }}</pre>
                  </details>
                }
              }
            </li>
          }
        </ol>
        @if (next()) {
          <button type="button" [disabled]="busy()" (click)="more()">Ver mais</button>
        }
      }
    </details>
  `,
})
export class HistoryPanel {
  readonly title = input.required<string>();
  readonly path = input.required<string>();
  readonly area = input<string>();
  readonly open = signal(false);
  readonly events = signal<HistoryEvent[]>([]);
  readonly entries = computed(() => {
    const entries: { event: HistoryEvent; count: number; key: string | null }[] = [];
    for (const event of this.events()) {
      const key = this.area() ? null : reorderKey(event);
      const previous = entries.at(-1);
      if (key && previous?.key === key) previous.count++;
      else entries.push({ event, count: 1, key });
    }
    return entries;
  });
  readonly next = signal<Filters | null>(null);
  readonly message = signal('');
  readonly busy = signal(false);
  private readonly injector = inject(Injector);
  private filters: Filters = {};
  private generation = 0;

  constructor() {
    effect(() => {
      this.path();
      this.reset();
    });
  }

  toggle(open: boolean) {
    this.open.set(open);
    if (!open) this.reset();
  }

  reset() {
    this.generation++;
    this.events.set([]);
    this.next.set(null);
    this.message.set('');
    this.busy.set(false);
  }

  search(event: SubmitEvent) {
    event.preventDefault();
    this.reset();
    this.filters = Object.fromEntries(
      [...new FormData(event.target as HTMLFormElement)].filter(([, value]) => value !== ''),
    ) as Filters;
    return this.load(this.filters);
  }

  more() {
    return this.load({ ...this.filters, ...this.next() });
  }

  private async load(params: Filters) {
    const generation = ++this.generation;
    const path = this.path();
    this.busy.set(true);
    this.message.set('');
    try {
      const page = await firstValueFrom(
        this.injector.get(HttpClient).get<Page>(path, {
          params,
          timeout: 15000,
          headers: { 'X-Bello-Flow-Request': '1' },
        }),
      );
      if (generation !== this.generation || path !== this.path()) return;
      this.events.update((events) => [...events, ...page.events]);
      this.next.set(page.next);
      if (!this.events().length) this.message.set('Nenhuma atividade encontrada.');
    } catch {
      if (generation !== this.generation || path !== this.path()) return;
      this.reset();
      this.message.set('Consulta indisponível ou sem permissão.');
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }
}
