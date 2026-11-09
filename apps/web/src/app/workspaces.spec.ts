import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session } from './session';
import { Workspaces } from './workspaces';

describe('Workspaces', () => {
  const base = '/api/workspaces';
  const workspace = { id: 'workspace', name: 'Trabalho', description: null };
  const board = { id: 'board', name: 'ERP', description: 'Privado' };

  function setup(parameters: Record<string, string> = {}) {
    const params = new BehaviorSubject(convertToParamMap(parameters));
    TestBed.configureTestingModule({
      imports: [Workspaces],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    });
    const fixture = TestBed.createComponent(Workspaces);
    const session = TestBed.inject(Session);
    const http = TestBed.inject(HttpTestingController);
    const page = fixture.componentInstance;
    fixture.detectChanges();
    session.signedIn({ account: { id: 'synthetic' } });
    fixture.detectChanges();
    return { fixture, session, http, page, params };
  }

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    sessionStorage.clear();
  });

  it('loads and creates Workspaces using the application request header', async () => {
    const { http, page, fixture } = setup();
    const list = http.expectOne(base);
    expect(list.request.headers.get('X-Bello-Flow-Request')).toBe('1');
    list.flush([]);
    fixture.detectChanges();
    const name = fixture.nativeElement.querySelector('#resource-name');
    const description = fixture.nativeElement.querySelector('#resource-description');
    const zone = fixture.nativeElement.querySelector('#workspace-zone');
    name.value = workspace.name;
    zone.value = 'America/Sao_Paulo';
    const pending = page.create(new Event('submit'), name, description, zone);
    await page.create(new Event('submit'), name, description, zone);
    const create = http.expectOne({ method: 'POST', url: base });
    expect(create.request.body.timeZone).toBe('America/Sao_Paulo');
    create.flush(workspace);
    await pending;
    expect(page.resources()).toEqual([workspace]);
    expect(name.value).toBe('');
    expect(page.resourceLink(workspace.id)).toEqual(['/workspaces', workspace.id]);
  });

  it('creates a board in the selected Workspace and handles a failed submission', async () => {
    const { http, page, fixture } = setup({ workspaceId: workspace.id });
    const path = base + '/workspace/boards';
    http.expectOne(path).flush([board]);
    expect(page.resourceLink(board.id)).toEqual(['/workspaces', workspace.id, 'boards', board.id]);
    fixture.detectChanges();
    const element = fixture.nativeElement;
    const pending = page.create(
      new Event('submit'),
      element.querySelector('#resource-name'),
      element.querySelector('#resource-description'),
      element.querySelector('#workspace-zone'),
    );
    const create = http.expectOne({ method: 'POST', url: path });
    expect(create.request.body).toEqual({
      name: '',
      description: '',
      operationId: expect.any(String),
    });
    create.flush({}, { status: 400, statusText: 'Bad request' });
    await pending;
    expect(page.message()).toContain('Não foi possível criar');
    expect(page.saving()).toBe(false);
  });

  it('reuses the operation after an uncertain response and keeps one list item', async () => {
    const { http, page, fixture } = setup();
    http.expectOne(base).flush([workspace]);
    fixture.detectChanges();
    const element = fixture.nativeElement;
    const submit = () =>
      page.create(
        new Event('submit'),
        element.querySelector('#resource-name'),
        element.querySelector('#resource-description'),
        element.querySelector('#workspace-zone'),
      );
    const first = submit();
    const request = http.expectOne({ method: 'POST', url: base });
    request.error(new ProgressEvent('network error'));
    await first;
    expect(page.message()).toContain('Não foi possível confirmar');
    const second = submit();
    const replay = http.expectOne({ method: 'POST', url: base });
    expect(replay.request.body).toEqual(request.request.body);
    replay.flush(workspace);
    await second;
    expect(page.resources()).toEqual([workspace]);
    expect(sessionStorage.length).toBe(0);
  });

  it('preserves a newer operation when an older response arrives', async () => {
    const { http, page, fixture } = setup();
    http.expectOne(base).flush([]);
    fixture.detectChanges();
    const element = fixture.nativeElement;
    const pending = page.create(
      new Event('submit'),
      element.querySelector('#resource-name'),
      element.querySelector('#resource-description'),
      element.querySelector('#workspace-zone'),
    );
    const request = http.expectOne({ method: 'POST', url: base });
    const key = 'bello.pending-create:synthetic:' + base;
    const newer = crypto.randomUUID();
    sessionStorage.setItem(key, newer);
    request.flush(workspace);
    await pending;
    expect(sessionStorage.getItem(key)).toBe(newer);
  });

  it('clears private content before loading a different board', () => {
    const { http, page, params, fixture, session } = setup({
      workspaceId: workspace.id,
      boardId: board.id,
    });
    http.expectOne(base + '/workspace/boards/board').flush(board);
    expect(page.board()).toEqual(board);
    params.next(convertToParamMap({ workspaceId: workspace.id, boardId: 'private' }));
    fixture.detectChanges();
    expect(page.board()).toBeNull();
    http
      .expectOne(base + '/workspace/boards/private')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(page.message()).toBe('Recurso indisponível.');
    expect(page.accessible()).toBe(false);
    session.signedOut();
    fixture.detectChanges();
    expect(page.board()).toBeNull();
  });
  it('clears board content when the signed-in account changes', () => {
    const { http, page, fixture, session } = setup({
      workspaceId: workspace.id,
      boardId: board.id,
    });
    const path = base + '/workspace/boards/board';
    http.expectOne(path).flush(board);
    fixture.detectChanges();
    http
      .expectOne(path + '/lists')
      .flush({ editable: true, lists: [{ id: 'private', name: 'Lista privada', cards: [] }] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Lista privada');

    session.signedIn({ account: { id: 'outra-conta' } });
    fixture.detectChanges();
    expect(page.board()).toBeNull();
    expect(element.textContent).not.toContain('Lista privada');
    http.expectOne(path).flush({}, { status: 403, statusText: 'Forbidden' });
  });
});
