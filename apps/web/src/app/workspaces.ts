import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { BoardContent } from './board-content';
import { Session } from './session';

interface Resource {
  id: string;
  name: string;
  description: string | null;
}

interface BoardSummary {
  id: string;
  name: string;
  archived: boolean;
}

interface BoardLifecycle {
  archivedBoards: BoardSummary[];
  managedBoards: BoardSummary[];
}

@Component({
  selector: 'app-workspaces',
  imports: [RouterLink, BoardContent],
  styleUrl: './auth-page.scss',
  template: `
    <section class="card" aria-labelledby="page-title">
      <h1 id="page-title" tabindex="-1">{{ title() }}</h1>
      <p><a [routerLink]="workspaceId() ? '/workspaces' : '/'">Voltar</a></p>
      @switch (session.state()) {
        @case ('loading') {
          <p role="status">Consultando sessão…</p>
        }
        @case ('anonymous') {
          <a routerLink="/login">Ir para o login</a>
        }
        @case ('unavailable') {
          <p role="status">Não foi possível consultar sua sessão.</p>
        }
        @case ('authenticated') {
          @if (loading()) {
            <p role="status">Carregando…</p>
          }
          @if (message()) {
            <p role="status">{{ message() }}</p>
          }
          @if (workspaceId() && accessible()) {
            <p><a [routerLink]="sharingLink()">Participantes</a></p>
            <p>
              <a [routerLink]="['/workspaces', workspaceId(), 'labels']">Etiquetas do Workspace</a>
            </p>
          }
          @if (board(); as selected) {
            <h2>{{ selected.name }}</h2>
            <p>{{ selected.description }}</p>
            @if (session.identity(); as identity) {
              <app-board-content
                [path]="path() + '/lists'"
                [accountId]="identity.account.id"
                (revoked)="clearBoard()"
              />
            }
          }
          @if (!boardId()) {
            <ul>
              @for (resource of resources(); track resource.id) {
                <li>
                  <a [routerLink]="resourceLink(resource.id)">{{ resource.name }}</a>
                </li>
              } @empty {
                @if (!loading() && !message()) {
                  <li>Nenhum item disponível.</li>
                }
              }
            </ul>
            @if (lifecycle(); as lifecycle) {
              @if (lifecycle.archivedBoards.length) {
                <h2>Quadros arquivados</h2>
                <ul>
                  @for (archived of lifecycle.archivedBoards; track archived.id) {
                    <li>
                      <a [routerLink]="resourceLink(archived.id)">{{ archived.name }}</a>
                    </li>
                  }
                </ul>
              }
              @if (lifecycle.managedBoards.length) {
                <h2>Governança dos quadros</h2>
                <ul>
                  @for (managed of lifecycle.managedBoards; track managed.id) {
                    <li>
                      {{ managed.name }}
                      @if (managed.archived) {
                        <span>Arquivado</span>
                      }
                      <button
                        type="button"
                        [disabled]="saving()"
                        (click)="archiveManagedBoard(managed)"
                      >
                        {{ managed.archived ? 'Restaurar quadro' : 'Arquivar quadro' }}
                      </button>
                    </li>
                  }
                </ul>
              }
            }
            @if (!loading() && accessible()) {
              <form (submit)="create($event, name, description, zone)">
                <label for="resource-name">Nome</label>
                <input id="resource-name" #name required />
                <label for="resource-description">Descrição</label>
                <textarea
                  id="resource-description"
                  #description
                  [required]="!!workspaceId()"
                ></textarea>
                <div [hidden]="!!workspaceId()">
                  <label for="workspace-zone">Fuso horário regional</label>
                  <input
                    id="workspace-zone"
                    #zone
                    [value]="defaultTimeZone"
                    [required]="!workspaceId()"
                  />
                </div>
                <button type="submit" [disabled]="saving()">
                  {{ workspaceId() ? 'Criar quadro' : 'Criar Workspace' }}
                </button>
              </form>
            }
          }
        }
      }
    </section>
  `,
})
export class Workspaces {
  readonly session = inject(Session);
  private readonly http = inject(HttpClient);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap, { requireSync: true });
  readonly resources = signal<Resource[]>([]);
  readonly board = signal<Resource | null>(null);
  readonly lifecycle = signal<BoardLifecycle | null>(null);
  readonly accessible = signal(false);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly message = signal('');
  readonly defaultTimeZone = Intl.DateTimeFormat()
    .resolvedOptions()
    .timeZone.replace(/^UTC$/, 'Etc/UTC');

  constructor() {
    effect((onCleanup) => {
      const path = this.path();
      const authenticated = this.session.state() === 'authenticated' && this.session.identity();
      this.resources.set([]);
      this.board.set(null);
      this.lifecycle.set(null);
      this.accessible.set(false);
      this.message.set('');
      if (!authenticated) return;
      this.loading.set(true);
      const detail = !!this.boardId();
      const showLifecycle = !!this.workspaceId() && !detail;
      const load = this.http.get<Resource | Resource[]>(path, this.options).subscribe({
        next: (response) => {
          if (Array.isArray(response)) this.resources.set(response);
          else if (detail) this.board.set(response);
          this.accessible.set(true);
          this.loading.set(false);
        },
        error: () => {
          this.message.set('Recurso indisponível.');
          this.loading.set(false);
        },
      });
      const lifecycle = showLifecycle
        ? this.http.get<BoardLifecycle>(path + '/lifecycle', this.options).subscribe({
            next: (result) => this.lifecycle.set(result),
            error: () => this.lifecycle.set(null),
          })
        : null;
      onCleanup(() => {
        load.unsubscribe();
        lifecycle?.unsubscribe();
      });
    });
  }

  private readonly options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };

  clearBoard() {
    this.board.set(null);
    this.accessible.set(false);
    this.message.set('Recurso indisponível.');
  }

  workspaceId() {
    return this.params().get('workspaceId');
  }

  boardId() {
    return this.params().get('boardId');
  }

  title() {
    return this.boardId()
      ? 'Quadro privado'
      : this.workspaceId()
        ? 'Quadros privados'
        : 'Workspaces';
  }

  sharingLink() {
    const path = ['/workspaces', this.workspaceId()];
    const boardId = this.boardId();
    return boardId ? [...path, 'boards', boardId, 'members'] : [...path, 'members'];
  }

  resourceLink(id: string) {
    const workspaceId = this.workspaceId();
    return workspaceId ? ['/workspaces', workspaceId, 'boards', id] : ['/workspaces', id];
  }

  path() {
    const workspaceId = this.workspaceId();
    const boardId = this.boardId();
    return (
      '/api/workspaces' +
      (workspaceId ? '/' + workspaceId + '/boards' : '') +
      (boardId ? '/' + boardId : '')
    );
  }

  async archiveManagedBoard(board: BoardSummary) {
    const identity = this.session.identity();
    if (!identity || this.saving()) return;
    const path = this.path();
    const current = () => path === this.path() && identity === this.session.identity();
    const archived = !board.archived;
    this.saving.set(true);
    this.message.set('');
    try {
      await firstValueFrom(
        this.http.post(
          path + '/' + board.id + '/archive',
          {
            archived,
            operationId: crypto.randomUUID(),
          },
          this.options,
        ),
      );
      if (current()) this.message.set(archived ? 'Quadro arquivado.' : 'Quadro restaurado.');
    } catch {
      if (current())
        this.message.set(
          'Não foi possível confirmar a alteração. Confira o estado atualizado do quadro.',
        );
    } finally {
      if (current()) {
        try {
          const result = await firstValueFrom(
            this.http.get<BoardLifecycle>(path + '/lifecycle', this.options),
          );
          if (current()) this.lifecycle.set(result);
        } catch {
          if (current()) this.lifecycle.set(null);
        }
      }
      this.saving.set(false);
    }
  }

  async create(
    event: Event,
    name: HTMLInputElement,
    description: HTMLTextAreaElement,
    zone: HTMLInputElement,
  ) {
    event.preventDefault();
    if (this.saving()) return;
    const path = this.path();
    const identity = this.session.identity();
    if (!identity) return;
    const pendingKey = 'bello.pending-create:' + identity.account.id + ':' + path;
    let operationId: string;
    try {
      operationId = sessionStorage.getItem(pendingKey) ?? crypto.randomUUID();
      sessionStorage.setItem(pendingKey, operationId);
    } catch {
      this.message.set('Não foi possível guardar a operação nesta aba. A criação não foi enviada.');
      return;
    }
    let confirmed = false;
    const body = { name: name.value, description: description.value, operationId };
    this.message.set('');
    this.saving.set(true);
    try {
      const resource = await firstValueFrom(
        this.http.post<Resource>(
          path,
          this.workspaceId() ? body : { ...body, timeZone: zone.value },
          this.options,
        ),
      );
      confirmed = true;
      if (path === this.path() && identity === this.session.identity()) {
        this.resources.update((resources) =>
          resources.some((item) => item.id === resource.id) ? resources : [...resources, resource],
        );
        name.value = '';
        description.value = '';
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        confirmed = true;
        this.message.set(
          'Uma criação anterior já foi concluída. Atualize a listagem antes de criar outro item.',
        );
      } else if (error instanceof HttpErrorResponse && error.status === 400) {
        this.message.set('Não foi possível criar. Confira os dados informados.');
      } else {
        this.message.set(
          'Não foi possível confirmar a criação. Repita com os mesmos dados para recuperar o resultado.',
        );
      }
    } finally {
      this.saving.set(false);
      if (confirmed && sessionStorage.getItem(pendingKey) === operationId) {
        sessionStorage.removeItem(pendingKey);
      }
    }
  }
}
