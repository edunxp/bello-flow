import { NgTemplateOutlet } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { HistoryPanel } from './history-panel';
import { BoardContent } from './board-content';
import { Session } from './session';

type BoardTheme = 'light' | 'dark' | 'system';
const themeKey = 'bello-flow-board-theme';

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
  imports: [RouterLink, BoardContent, HistoryPanel, NgTemplateOutlet],
  styleUrls: ['./auth-page.scss', './workspaces-board.scss'],
  host: {
    '(document:click)': 'dismissWorkspaceMenu($event.target)',
    '(document:keydown.escape)': 'closeWorkspaceMenu($event)',
  },
  template: `
    <section class="card" [class.board-page]="board()" aria-labelledby="page-title">
      <h1 id="page-title" tabindex="-1" [hidden]="board()">{{ title() }}</h1>
      <p [hidden]="board()"><a [routerLink]="workspaceId() ? '/workspaces' : '/'">Voltar</a></p>
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
          @if (workspaceId() && accessible() && !board()) {
            <p><a [routerLink]="sharingLink()">Participantes</a></p>
            <p>
              <a [routerLink]="['/workspaces', workspaceId(), 'labels']">Etiquetas do Workspace</a>
            </p>
          }
          @if (workspaceId() && accessible() && !boardId()) {
            <app-history-panel
              title="Auditoria administrativa do Workspace"
              [path]="path() + '/audit'"
              area="GOVERNANCE"
            />
          }
          @if (board(); as selected) {
            @if (session.identity(); as identity) {
              <div
                class="board-shell"
                [class.nav-closed]="!navigationOpen()"
                [attr.data-theme]="theme()"
              >
                <nav
                  id="board-navigation"
                  aria-label="Navegação do quadro"
                  [hidden]="!navigationOpen()"
                >
                  <a routerLink="/workspaces" aria-label="Workspaces" title="Workspaces"
                    ><svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" /></svg
                  ></a>
                  <span aria-current="page" aria-label="Quadro atual" title="Quadro atual"
                    ><svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path d="M9 4v16m6-16v16" /></svg
                  ></span>
                  <a [routerLink]="sharingLink()" aria-label="Participantes" title="Participantes"
                    ><svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="9" cy="8" r="3" />
                      <path
                        d="M3 20v-2a6 6 0 0 1 12 0v2m2-15a3 3 0 0 1 0 6m4 9v-2a6 6 0 0 0-3-5"
                      /></svg
                  ></a>
                  <a
                    [routerLink]="['/workspaces', workspaceId(), 'labels']"
                    aria-label="Etiquetas do Workspace"
                    title="Etiquetas do Workspace"
                    ><svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 3h8l10 10-8 8L3 11z" />
                      <circle cx="7.5" cy="7.5" r="1" /></svg
                  ></a>
                  <a routerLink="/notifications" aria-label="Notificações" title="Notificações"
                    ><svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zm5 3a2 2 0 0 0 4 0" /></svg
                  ></a>
                </nav>
                <div class="board-surface" [style.background-image]="wallpaper()">
                  <div class="board-toolbar">
                    <a class="board-wordmark" routerLink="/" aria-label="Bello Flow, início">
                      <span class="board-mark" aria-hidden="true"><i></i><i></i><i></i></span>Bello
                      Flow
                    </a>
                    <details
                      #workspaceMenu
                      class="workspace-switch"
                      (focusout)="dismissWorkspaceMenu($event.relatedTarget)"
                    >
                      <summary>
                        {{ currentWorkspaceName() }} <span aria-hidden="true">⌄</span>
                      </summary>
                      <div class="workspace-menu">
                        @for (workspace of boardWorkspaces(); track workspace.id) {
                          <a
                            [routerLink]="['/workspaces', workspace.id]"
                            [attr.aria-current]="workspace.id === workspaceId() ? 'true' : null"
                            >{{ workspace.name }}</a
                          >
                        }
                        <a routerLink="/workspaces" (click)="workspaceMenu.open = false"
                          >Todos os Workspaces</a
                        >
                      </div>
                    </details>
                    <button
                      type="button"
                      class="board-icon appearance-trigger"
                      aria-label="Aparência pessoal"
                      title="Aparência pessoal"
                      aria-haspopup="dialog"
                      (click)="appearance.showModal()"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                        aria-hidden="true"
                      >
                        <path d="M20 15a8 8 0 0 1-11-11 8 8 0 1 0 11 11Z" />
                        <path d="M17 3v6m-3-3h6" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      class="board-icon"
                      [attr.aria-label]="
                        navigationOpen() ? 'Recolher navegação' : 'Mostrar navegação'
                      "
                      [attr.title]="navigationOpen() ? 'Recolher navegação' : 'Mostrar navegação'"
                      [attr.aria-expanded]="navigationOpen()"
                      aria-controls="board-navigation"
                      (click)="navigationOpen.set(!navigationOpen())"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                        aria-hidden="true"
                      >
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <path d="M9 4v16" />
                      </svg>
                    </button>
                  </div>
                  <header class="board-heading">
                    <div>
                      <p class="board-workspace-name">{{ currentWorkspaceName() }}</p>
                      <h2>{{ selected.name }}</h2>
                      <p>{{ selected.description }}</p>
                    </div>
                    <div class="board-heading-actions">
                      @if (boardContent.participants().length; as count) {
                        <button
                          type="button"
                          class="board-people"
                          aria-haspopup="dialog"
                          [attr.aria-label]="'Ver participantes do quadro (' + count + ')'"
                          (click)="people.showModal()"
                        >
                          @for (
                            person of boardContent.participants().slice(0, 3);
                            track person.accountId
                          ) {
                            <span class="person-initial" aria-hidden="true">{{
                              person.email.slice(0, 2).toUpperCase()
                            }}</span>
                          }
                          <span>{{ count === 1 ? '1 pessoa' : count + ' pessoas' }}</span>
                        </button>
                      }
                      <button
                        type="button"
                        class="board-icon board-settings-trigger"
                        aria-label="Configurações do quadro"
                        title="Configurações do quadro"
                        aria-haspopup="dialog"
                        (click)="settings.showModal()"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="20"
                          height="20"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.7"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="3" />
                          <path
                            d="M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3m0-14-3 3m-8 8-3 3"
                          />
                          <circle cx="12" cy="12" r="8" />
                        </svg>
                      </button>
                    </div>
                  </header>
                  <dialog #people class="board-settings" aria-labelledby="board-people-title">
                    <header>
                      <h3 id="board-people-title">Participantes do quadro</h3>
                      <button type="button" (click)="people.close()">Fechar</button>
                    </header>
                    <ul class="board-people-list">
                      @for (person of boardContent.participants(); track person.accountId) {
                        <li>
                          <span class="person-initial" aria-hidden="true">{{
                            person.email.slice(0, 2).toUpperCase()
                          }}</span
                          >{{ person.email }}
                        </li>
                      }
                    </ul>
                    <a [routerLink]="sharingLink()">Gerenciar participantes</a>
                  </dialog>
                  <dialog
                    #appearance
                    class="board-settings"
                    aria-labelledby="board-appearance-title"
                  >
                    <header>
                      <h3 id="board-appearance-title">Aparência pessoal</h3>
                      <button type="button" (click)="appearance.close()">Fechar</button>
                    </header>
                    <fieldset class="theme-options">
                      <legend>Tema do quadro</legend>
                      @for (option of themeOptions; track option.value) {
                        <label
                          ><input
                            type="radio"
                            name="board-theme"
                            [checked]="theme() === option.value"
                            (change)="setTheme(option.value)"
                          />{{ option.label }}</label
                        >
                      }
                    </fieldset>
                  </dialog>
                  <dialog #settings class="board-settings" aria-labelledby="board-settings-title">
                    <header>
                      <h3 id="board-settings-title">Configurações do quadro</h3>
                      <button type="button" (click)="settings.close()">Fechar</button>
                    </header>
                    <h4>Aparência</h4>
                    <label for="board-wallpaper">Foto de fundo nesta sessão</label>
                    <input
                      id="board-wallpaper"
                      #photo
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/avif"
                      (change)="setWallpaper(photo)"
                    />
                    <button type="button" (click)="resetWallpaper(); photo.value = ''">
                      Restaurar fundo
                    </button>
                    @if (wallpaperMessage()) {
                      <p role="status">{{ wallpaperMessage() }}</p>
                    }
                    <h4>Atividade e gestão</h4>
                    <ng-container [ngTemplateOutlet]="boardContent.boardActions()" />
                    <h4>Auditoria</h4>
                    <app-history-panel
                      title="Auditoria administrativa do quadro"
                      [path]="path() + '/audit'"
                      area="GOVERNANCE"
                    />
                    <app-history-panel
                      title="Auditoria de conteúdo do quadro"
                      [path]="path() + '/audit'"
                      area="CONTENT"
                    />
                  </dialog>
                  <app-board-content
                    #boardContent
                    [path]="path() + '/lists'"
                    [accountId]="identity.account.id"
                    (revoked)="clearBoard()"
                  />
                </div>
              </div>
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

  private readonly workspaceMenu = viewChild<ElementRef<HTMLDetailsElement>>('workspaceMenu');

  dismissWorkspaceMenu(target: EventTarget | null) {
    const menu = this.workspaceMenu()?.nativeElement;
    if (menu?.open && (!(target instanceof Node) || !menu.contains(target))) menu.open = false;
  }

  closeWorkspaceMenu(event: Event) {
    const menu = this.workspaceMenu()?.nativeElement;
    if (!menu?.open || !(event.target instanceof Node) || !menu.contains(event.target)) return;
    menu.open = false;
    menu.querySelector('summary')?.focus();
  }

  readonly boardWorkspaces = signal<Resource[]>([]);
  readonly theme = signal<BoardTheme>(this.readTheme());
  readonly themeOptions: { value: BoardTheme; label: string }[] = [
    { value: 'light', label: 'Claro' },
    { value: 'dark', label: 'Escuro' },
    { value: 'system', label: 'Seguir o sistema' },
  ];

  currentWorkspaceName() {
    return this.boardWorkspaces().find(({ id }) => id === this.workspaceId())?.name ?? 'Workspace';
  }

  private readTheme(): BoardTheme {
    try {
      const theme = localStorage.getItem(themeKey);
      if (theme === 'dark' || theme === 'system') return theme;
    } catch {
      // The board can still render when browser storage is unavailable.
    }
    return 'light';
  }

  setTheme(theme: BoardTheme) {
    this.theme.set(theme);
    try {
      localStorage.setItem(themeKey, theme);
    } catch {
      // Keep the preference for the current page.
    }
  }

  readonly navigationOpen = signal(true);
  readonly wallpaper = signal<string | null>(null);
  readonly wallpaperMessage = signal('');
  private wallpaperUrl: string | null = null;

  setWallpaper(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(file.type) ||
      file.size > 12_000_000
    ) {
      this.wallpaperMessage.set('Escolha uma imagem PNG, JPEG, WebP ou AVIF de até 12 MB.');
      input.value = '';
      return;
    }
    this.resetWallpaper();
    this.wallpaperUrl = URL.createObjectURL(file);
    this.wallpaper.set('url("' + this.wallpaperUrl + '")');
  }

  resetWallpaper() {
    if (this.wallpaperUrl) URL.revokeObjectURL(this.wallpaperUrl);
    this.wallpaperUrl = null;
    this.wallpaper.set(null);
    this.wallpaperMessage.set('');
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.resetWallpaper());
    effect((onCleanup) => {
      const path = this.path();
      this.resetWallpaper();
      const authenticated = this.session.state() === 'authenticated' && this.session.identity();
      this.resources.set([]);
      this.boardWorkspaces.set([]);
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
      const workspaces = detail
        ? this.http.get<Resource[]>('/api/workspaces', this.options).subscribe({
            next: (result) => this.boardWorkspaces.set(result),
            error: () => this.boardWorkspaces.set([]),
          })
        : null;
      const lifecycle = showLifecycle
        ? this.http.get<BoardLifecycle>(path + '/lifecycle', this.options).subscribe({
            next: (result) => this.lifecycle.set(result),
            error: () => this.lifecycle.set(null),
          })
        : null;
      onCleanup(() => {
        load.unsubscribe();
        workspaces?.unsubscribe();
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
