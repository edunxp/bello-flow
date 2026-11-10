import { HttpClient } from '@angular/common/http';
import { Component, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

interface Target {
  id: string;
  name: string;
  lists: { id: string; name: string }[];
}

interface Impact {
  impact: string;
  incompatible: { accountId: string; email: string }[];
}

@Component({
  selector: 'app-card-transfer',
  template: `
    <button type="button" [disabled]="busy()" (click)="open()">Mover para outro quadro</button>
    @if (targets(); as options) {
      <form (submit)="preview($event, choice.value)">
        <label [attr.for]="'transfer-' + cardId()">Quadro e lista de destino</label>
        <select
          [id]="'transfer-' + cardId()"
          #choice
          [disabled]="busy()"
          required
          (change)="impact.set(null)"
        >
          <option value="">Escolher destino</option>
          @for (board of options; track board.id) {
            @for (list of board.lists; track list.id) {
              <option [value]="board.id + '/' + list.id">{{ board.name }} / {{ list.name }}</option>
            }
          }
        </select>
        <button [disabled]="busy()">Ver impacto</button>
        <button type="button" [disabled]="busy()" (click)="close()">Cancelar</button>
      </form>
      @if (impact(); as review) {
        <p>O cartão será colocado no fim da lista de destino.</p>
        @if (review.incompatible.length) {
          <p>Os seguintes responsáveis serão removidos:</p>
          <ul>
            @for (person of review.incompatible; track person.accountId) {
              <li>{{ person.email }}</li>
            }
          </ul>
        }
        <button type="button" [disabled]="busy()" (click)="confirm()">Confirmar movimento</button>
      }
    }
    @if (message()) {
      <p role="status">{{ message() }}</p>
    }
  `,
})
export class CardTransfer {
  readonly cardId = input.required<string>();
  readonly path = input.required<string>();
  readonly boardPath = input.required<string>();
  readonly moved = output<void>();
  readonly targets = signal<Target[] | null>(null);
  readonly impact = signal<
    (Impact & { destinationBoardId: string; destinationListId: string; operationId: string }) | null
  >(null);
  readonly busy = signal(false);
  readonly message = signal('');
  private readonly http = inject(HttpClient);
  private readonly options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };

  open() {
    return this.run(async () => {
      this.impact.set(null);
      this.targets.set(
        await firstValueFrom(
          this.http.get<Target[]>(this.boardPath() + '/transfer-targets', this.options),
        ),
      );
    });
  }

  close() {
    this.targets.set(null);
    this.impact.set(null);
    this.message.set('');
  }

  preview(event: Event, choice: string) {
    event.preventDefault();
    return this.run(async () => {
      this.impact.set(null);
      const [destinationBoardId, destinationListId] = choice.split('/');
      const params = { destinationBoardId, destinationListId };
      const impact = await firstValueFrom(
        this.http.get<Impact>(this.path(), { ...this.options, params }),
      );
      this.impact.set({ ...impact, ...params, operationId: crypto.randomUUID() });
    });
  }

  confirm() {
    const review = this.impact();
    if (!review) return;
    return this.run(async () => {
      const { impact, operationId, destinationBoardId, destinationListId } = review;
      await firstValueFrom(
        this.http.post(
          this.path(),
          { impact, operationId, destinationBoardId, destinationListId },
          this.options,
        ),
      );
      this.close();
      this.moved.emit();
    });
  }

  private async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    try {
      await action();
    } catch {
      this.message.set(
        'Não foi possível mover o cartão. Confira o destino e consulte o impacto novamente.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
