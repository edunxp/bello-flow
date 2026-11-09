import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Session } from './session';

interface Resource {
  id: string;
  name: string;
  description: string | null;
}

@Component({
  selector: 'app-workspaces',
  imports: [RouterLink],
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
          @if (board(); as selected) {
            <h2>{{ selected.name }}</h2>
            <p>{{ selected.description }}</p>
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
      const authenticated = this.session.state() === 'authenticated';
      this.resources.set([]);
      this.board.set(null);
      this.accessible.set(false);
      this.message.set('');
      if (!authenticated) return;
      this.loading.set(true);
      const detail = !!this.boardId();
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
      onCleanup(() => load.unsubscribe());
    });
  }

  private readonly options = { headers: { 'X-Bello-Flow-Request': '1' }, timeout: 15000 };

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

  resourceLink(id: string) {
    const workspaceId = this.workspaceId();
    return workspaceId ? ['/workspaces', workspaceId, 'boards', id] : ['/workspaces', id];
  }

  private path() {
    const workspaceId = this.workspaceId();
    const boardId = this.boardId();
    return (
      '/api/workspaces' +
      (workspaceId ? '/' + workspaceId + '/boards' : '') +
      (boardId ? '/' + boardId : '')
    );
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
    const body = { name: name.value, description: description.value };
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
      if (path === this.path() && identity === this.session.identity()) {
        this.resources.update((resources) => [...resources, resource]);
        name.value = '';
        description.value = '';
      }
    } catch {
      this.message.set(
        'Não foi possível criar. Confira os dados e a listagem antes de tentar novamente.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
