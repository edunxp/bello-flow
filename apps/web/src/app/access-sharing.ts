import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Session } from './session';

interface Member {
  accountId?: string;
  email: string;
  role: string;
}

interface Impact {
  count: number;
  token: string;
}

interface Participants {
  members: Member[];
  boards: { id: string; name: string }[];
}
interface Notice {
  id: string;
  grantedRole: string;
  workspaceId: string;
  boardId: string | null;
  actor: { emailKey: string };
  workspace: { name: string };
  board: { name: string } | null;
}
const options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };

@Component({
  selector: 'app-access-sharing',
  imports: [RouterLink],
  styleUrl: './auth-page.scss',
  template: `
    <section class="card" aria-labelledby="page-title">
      <h1 id="page-title" tabindex="-1">{{ central ? 'Notificações' : 'Participantes' }}</h1>
      <p><a routerLink="/workspaces">Voltar aos Workspaces</a></p>
      @switch (session.state()) {
        @case ('anonymous') {
          <a routerLink="/login">Ir para o login</a>
        }
        @case ('unavailable') {
          <p role="status">Não foi possível consultar sua sessão.</p>
        }
        @case ('authenticated') {
          @if (message()) {
            <p role="status">{{ message() }}</p>
          }
          @if (central) {
            <ul>
              @for (notice of notices(); track notice.id) {
                <li>
                  {{ notice.actor.emailKey }} concedeu acesso como
                  {{ roleName(notice.grantedRole) }} a
                  <a [routerLink]="noticeLink(notice)">{{
                    notice.board?.name ?? notice.workspace.name
                  }}</a
                  >.
                </li>
              } @empty {
                @if (loaded()) {
                  <li>Nenhuma notificação.</li>
                }
              }
            </ul>
          } @else if (participants(); as data) {
            <ul aria-label="Participantes">
              @for (member of data.members; track member.email) {
                <li>
                  {{ member.email }} · {{ roleName(member.role) }}
                  @if (boardId() && member.accountId && !pending() && !change()) {
                    <form (submit)="prepareChange($event, member, newRole.value)">
                      <label [attr.for]="'change-' + member.accountId"
                        >Alterar acesso de {{ member.email }}</label
                      >
                      <select [id]="'change-' + member.accountId" #newRole required>
                        <option value="">Escolher ação</option>
                        @for (role of roles; track role) {
                          @if (role !== member.role) {
                            <option [value]="role">{{ roleName(role) }}</option>
                          }
                        }
                        <option value="REMOVE">Remover do quadro</option>
                      </select>
                      <button type="submit" [disabled]="saving()">Revisar alteração</button>
                    </form>
                  }
                </li>
              }
            </ul>
            @if (data.boards.length) {
              <h2>Gerenciar acesso aos quadros</h2>
              <ul>
                @for (board of data.boards; track board.id) {
                  <li>
                    <a
                      [routerLink]="['/workspaces', workspaceId(), 'boards', board.id, 'members']"
                      >{{ board.name }}</a
                    >
                  </li>
                }
              </ul>
            }
            @if (change(); as selection) {
              @if (selection.role === null) {
                <p>
                  Remover {{ selection.member.email }} do quadro? O acesso ao conteúdo será
                  revogado.
                </p>
              } @else {
                <p>
                  Alterar o papel de {{ selection.member.email }} de
                  {{ roleName(selection.member.role) }} para {{ roleName(selection.role) }}?
                </p>
              }
              @if (selection.impact; as impact) {
                <p>
                  Atribuições que serão removidas: {{ impact.count }}. Os cartões e o histórico
                  serão preservados.
                </p>
                @if (impact.count > 0) {
                  <label>
                    <input
                      type="checkbox"
                      [checked]="confirmAssignments()"
                      #confirmImpact
                      (change)="confirmAssignments.set(confirmImpact.checked)"
                    />
                    Confirmo a remoção das atribuições
                  </label>
                }
              }
              <button
                type="button"
                [disabled]="saving() || (!!selection.impact?.count && !confirmAssignments())"
                (click)="confirmChange()"
              >
                Confirmar alteração
              </button>
              <button type="button" [disabled]="saving()" (click)="change.set(null)">
                Cancelar
              </button>
            } @else if (pending(); as selection) {
              <p>Conceder acesso de {{ roleName(selection.role) }} a {{ selection.email }}?</p>
              <button type="button" [disabled]="saving()" (click)="confirm()">
                Confirmar inclusão
              </button>
              <button type="button" [disabled]="saving()" (click)="pending.set(null)">
                Cancelar
              </button>
            } @else {
              <form (submit)="prepare($event, email.value, role.value)">
                <label for="member-email">E-mail da conta</label>
                <input id="member-email" type="email" #email required />
                <label for="member-role">Papel</label>
                <select id="member-role" #role>
                  <option value="MEMBER">Membro</option>
                  <option value="ADMIN">Administrador</option>
                  @if (boardId()) {
                    <option value="OBSERVER">Observador</option>
                  }
                </select>
                <button type="submit">Revisar inclusão</button>
              </form>
            }
          }
        }
      }
    </section>
  `,
})
export class AccessSharing {
  readonly session = inject(Session);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly params = toSignal(this.route.paramMap, { requireSync: true });
  readonly central = this.route.snapshot.data['central'] === true;
  readonly participants = signal<Participants | null>(null);
  readonly notices = signal<Notice[]>([]);
  readonly loaded = signal(false);
  readonly pending = signal<{ email: string; role: string } | null>(null);
  readonly roles = ['MEMBER', 'ADMIN', 'OBSERVER'];
  readonly change = signal<{
    member: Member;
    role: string | null;
    operationId: string;
    impact?: Impact;
  } | null>(null);
  readonly confirmAssignments = signal(false);
  readonly message = signal('');
  readonly saving = signal(false);

  constructor() {
    effect((onCleanup) => {
      const path = this.path();
      this.participants.set(null);
      this.notices.set([]);
      this.loaded.set(false);
      this.pending.set(null);
      this.change.set(null);
      this.message.set('');
      if (this.session.state() !== 'authenticated' || !this.session.identity()) return;
      const loading = this.http.get<Participants | Notice[]>(path, options).subscribe({
        next: (data) => {
          if (Array.isArray(data)) this.notices.set(data);
          else this.participants.set(data);
          this.loaded.set(true);
        },
        error: () => this.message.set('Recurso indisponível.'),
      });
      onCleanup(() => loading.unsubscribe());
    });
  }

  workspaceId() {
    return this.params().get('workspaceId');
  }

  boardId() {
    return this.params().get('boardId');
  }

  private path() {
    const base = '/api/workspaces';
    if (this.central) return base + '/notifications';
    const boardId = this.boardId();
    return base + '/' + this.workspaceId() + (boardId ? '/boards/' + boardId : '') + '/members';
  }

  noticeLink(notice: Notice) {
    const path = ['/workspaces', notice.workspaceId];
    return notice.boardId ? [...path, 'boards', notice.boardId] : path;
  }

  roleName(role: string) {
    if (role === 'ADMIN') return 'Administrador';
    if (role === 'OBSERVER') return 'Observador';
    return 'Membro';
  }

  prepare(event: Event, email: string, role: string) {
    event.preventDefault();
    this.pending.set({ email: email.trim(), role });
  }

  async prepareChange(event: Event, member: Member, choice: string) {
    event.preventDefault();
    if (this.saving() || !member.accountId || (choice !== 'REMOVE' && !this.roles.includes(choice)))
      return;
    this.confirmAssignments.set(false);
    const role = choice === 'REMOVE' ? null : choice;
    const operationId = crypto.randomUUID();
    if (role !== null && role !== 'OBSERVER') {
      this.change.set({ member, role, operationId });
      return;
    }

    const path = this.path();
    const identity = this.session.identity();
    const current = () => path === this.path() && identity === this.session.identity();
    this.saving.set(true);
    this.message.set('');
    try {
      const impact = await firstValueFrom(
        this.http.get<Impact>(path + '/' + member.accountId + '/assignment-impact', options),
      );
      if (current()) this.change.set({ member, role, operationId, impact });
    } catch {
      if (current())
        this.message.set('Não foi possível consultar o impacto. Revise a alteração novamente.');
    } finally {
      this.saving.set(false);
    }
  }

  async confirmChange() {
    const change = this.change();
    const identity = this.session.identity();
    if (
      !change ||
      this.saving() ||
      !identity ||
      (change.impact?.count && !this.confirmAssignments())
    )
      return;
    const path = this.path();
    const current = () => path === this.path() && identity === this.session.identity();
    this.saving.set(true);
    this.message.set('');
    try {
      await firstValueFrom(
        this.http.post(
          path + '/change',
          {
            accountId: change.member.accountId,
            expectedRole: change.member.role,
            role: change.role,
            operationId: change.operationId,
            impactToken: change.impact?.token,
            confirmAssignments: this.confirmAssignments(),
          },
          options,
        ),
      );
      if (!current()) return;
      this.change.set(null);
      this.message.set(change.role === null ? 'Participante removido.' : 'Papel atualizado.');
      await this.refreshParticipants(path, current);
    } catch (error) {
      if (!current()) return;
      if (error instanceof HttpErrorResponse && [403, 409].includes(error.status)) {
        this.change.set(null);
        this.message.set(
          error.status === 409
            ? 'O impacto ou o acesso mudou, ou a alteração deixaria o quadro sem Administrador ativo. Revise novamente.'
            : 'A alteração está indisponível para esta conta.',
        );
        await this.refreshParticipants(path, current);
      } else {
        this.message.set(
          'Não foi possível confirmar a alteração. Repita a confirmação para verificar o resultado.',
        );
      }
    } finally {
      this.saving.set(false);
    }
  }

  private async refreshParticipants(path: string, current: () => boolean) {
    try {
      const data = await firstValueFrom(this.http.get<Participants>(path, options));
      if (current()) this.participants.set(data);
    } catch {
      if (current()) this.participants.set(null);
    }
  }

  async confirm() {
    const selected = this.pending();
    if (!selected || this.saving() || this.session.state() !== 'authenticated') return;
    const path = this.path();
    const identity = this.session.identity();
    this.saving.set(true);
    this.message.set('');
    try {
      await firstValueFrom(this.http.post<void>(path, selected, options));
      if (path !== this.path() || identity !== this.session.identity()) return;
      this.pending.set(null);
      this.message.set('Acesso concedido.');
      const data = await firstValueFrom(this.http.get<Participants>(path, options));
      if (path === this.path() && identity === this.session.identity()) this.participants.set(data);
    } catch (error) {
      if (path !== this.path() || identity !== this.session.identity()) return;
      this.message.set(
        error instanceof HttpErrorResponse && error.status === 409
          ? 'A conta já participa com outro papel.'
          : this.pending()
            ? 'Não foi possível confirmar a inclusão. Confira o e-mail, o papel e as permissões.'
            : 'Acesso concedido. Reabra a lista para atualizar os participantes.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
