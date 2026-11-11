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
    localStorage.clear();
  });

  it('applies a valid photo for the current board and releases it on reset', () => {
    const { http, page, fixture } = setup();
    http.expectOne(base).flush([]);
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:board-photo');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const select = (file?: File) =>
      page.setWallpaper({
        files: file ? [file] : [],
        value: 'photo',
      } as unknown as HTMLInputElement);
    select();
    expect(page.wallpaper()).toBeNull();
    select(new File(['text'], 'photo.txt', { type: 'text/plain' }));
    expect(page.wallpaperMessage()).toContain('até 12 MB');
    select(new File(['image'], 'photo.png', { type: 'image/png' }));
    expect(page.wallpaper()).toBe('url("blob:board-photo")');
    expect(page.wallpaperMessage()).toBe('');
    page.resetWallpaper();
    expect(revoke).toHaveBeenCalledWith('blob:board-photo');
    expect(page.wallpaper()).toBeNull();
    fixture.destroy();
    objectUrl.mockRestore();
    revoke.mockRestore();
  });

  it('reopens the navigation and puts the appearance controls in board settings', () => {
    const { http, fixture, page } = setup({ workspaceId: workspace.id, boardId: board.id });
    const path = base + '/workspace/boards/board';
    http.expectOne(path).flush(board);
    http.expectOne(base).flush([workspace]);
    fixture.detectChanges();
    http.expectOne(path + '/lists').flush({ editable: false, canArchive: true, lists: [] });
    fixture.detectChanges();
    http
      .expectOne(path + '/members')
      .flush({ members: [{ accountId: 'other', email: 'other@example.test' }] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const menu = element.querySelector<HTMLDetailsElement>('.workspace-switch')!;
    const summary = menu.querySelector('summary')!;
    const workspaceLink = menu.querySelector('a')!;
    menu.open = true;
    menu.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: workspaceLink }));
    expect(menu.open).toBe(true);
    element.querySelector('h2')!.click();
    expect(menu.open).toBe(false);
    menu.open = true;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    menu.open = true;
    menu.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(menu.open).toBe(false);
    expect(element.querySelector('.workspace-switch summary')?.textContent).toContain(
      workspace.name,
    );
    expect(element.querySelector('a[aria-current="true"]')?.textContent).toContain(workspace.name);
    const participants = element.querySelector<HTMLDialogElement>(
      'dialog[aria-labelledby="board-people-title"]',
    )!;
    participants.showModal = vi.fn();
    participants.close = vi.fn();
    element.querySelector<HTMLButtonElement>('.board-people')!.click();
    expect(participants.showModal).toHaveBeenCalledOnce();
    expect(participants.textContent).toContain('other@example.test');
    participants.querySelector('button')!.click();
    expect(participants.close).toHaveBeenCalledOnce();
    const appearance = element.querySelector<HTMLDialogElement>(
      'dialog[aria-labelledby="board-appearance-title"]',
    )!;
    appearance.showModal = vi.fn();
    appearance.close = vi.fn();
    element.querySelector<HTMLButtonElement>('[aria-label="Aparência pessoal"]')!.click();
    expect(appearance.showModal).toHaveBeenCalledOnce();
    const radios = appearance.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[1]!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(element.querySelector('.board-shell')?.getAttribute('data-theme')).toBe('dark');
    radios[2]!.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('bello-flow-board-theme')).toBe('system');
    appearance.querySelector('button')!.click();
    expect(appearance.close).toHaveBeenCalledOnce();
    const navigation = element.querySelector<HTMLButtonElement>(
      '[aria-controls="board-navigation"]',
    )!;
    navigation.click();
    fixture.detectChanges();
    expect(element.querySelector<HTMLElement>('#board-navigation')?.hidden).toBe(true);
    expect(navigation.getAttribute('aria-label')).toBe('Mostrar navegação');
    navigation.click();
    fixture.detectChanges();
    expect(navigation.getAttribute('aria-expanded')).toBe('true');

    const settings = element.querySelector<HTMLDialogElement>(
      'dialog[aria-labelledby="board-settings-title"]',
    )!;
    settings.showModal = vi.fn();
    settings.close = vi.fn();
    element.querySelector<HTMLButtonElement>('[aria-label="Configurações do quadro"]')!.click();
    expect(settings.showModal).toHaveBeenCalledOnce();
    const photo = settings.querySelector<HTMLInputElement>('#board-wallpaper')!;
    Object.defineProperty(photo, 'files', {
      value: [new File(['text'], 'photo.txt', { type: 'text/plain' })],
    });
    photo.dispatchEvent(new Event('change'));
    expect(page.wallpaperMessage()).toContain('até 12 MB');
    const [close, reset] = [...settings.querySelectorAll('button')];
    reset!.click();
    expect(page.wallpaperMessage()).toBe('');
    close!.click();
    expect(settings.close).toHaveBeenCalledOnce();
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
    http.expectOne(path + '/lifecycle').flush({ archivedBoards: [], managedBoards: [] });
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

  it('shows archived participants separately and manages private boards without content links', async () => {
    const { http, page, fixture } = setup({ workspaceId: workspace.id });
    const path = base + '/workspace/boards';
    const archived = { id: 'archive', name: 'Meu arquivo', archived: true };
    const managed = { id: 'managed', name: 'Quadro administrado', archived: false };
    http.expectOne(path).flush([]);
    http
      .expectOne(path + '/lifecycle')
      .flush({ archivedBoards: [archived], managedBoards: [managed] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('a[href$="/archive"]')?.textContent).toBe(archived.name);
    expect(element.querySelector('a[href$="/managed"]')).toBeNull();
    const pending = page.archiveManagedBoard(managed);
    const request = http.expectOne({ method: 'POST', url: path + '/managed/archive' });
    expect(request.request.body.archived).toBe(true);
    request.flush(null);
    await Promise.resolve();
    http
      .expectOne(path + '/lifecycle')
      .flush({ archivedBoards: [archived], managedBoards: [{ ...managed, archived: true }] });
    await pending;
    fixture.detectChanges();
    expect(element.textContent).toContain('Restaurar quadro');
    expect(page.message()).toBe('Quadro arquivado.');
  });

  it('refreshes governance after an uncertain response and clears it if access is lost', async () => {
    const { http, page } = setup({ workspaceId: workspace.id });
    const path = base + '/workspace/boards';
    const managed = { id: 'managed', name: 'Quadro administrado', archived: true };
    http.expectOne(path).flush([]);
    http.expectOne(path + '/lifecycle').flush({ archivedBoards: [], managedBoards: [managed] });
    const pending = page.archiveManagedBoard(managed);
    await page.archiveManagedBoard(managed);
    const request = http.expectOne({ method: 'POST', url: path + '/managed/archive' });
    expect(request.request.body.archived).toBe(false);
    request.error(new ProgressEvent('network'));
    await Promise.resolve();
    http.expectOne(path + '/lifecycle').flush(null, { status: 403, statusText: 'Forbidden' });
    await pending;
    expect(page.lifecycle()).toBeNull();
    expect(page.message()).toContain('Não foi possível confirmar');
  });

  it('keeps a delayed governance response out of the next Workspace', async () => {
    const { fixture, http, page, params } = setup({ workspaceId: workspace.id });
    const path = base + '/workspace/boards';
    const managed = { id: 'managed', name: 'Quadro administrado', archived: true };
    http.expectOne(path).flush([]);
    http.expectOne(path + '/lifecycle').flush({ archivedBoards: [], managedBoards: [managed] });
    const pending = page.archiveManagedBoard(managed);
    const request = http.expectOne({ method: 'POST', url: path + '/managed/archive' });
    params.next(convertToParamMap({ workspaceId: 'other' }));
    fixture.detectChanges();
    const other = base + '/other/boards';
    http.expectOne(other).flush([]);
    http.expectOne(other + '/lifecycle').flush({ archivedBoards: [], managedBoards: [] });
    request.flush(null);
    await pending;
    http.expectNone(path + '/lifecycle');
    expect(page.message()).toBe('');
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
    http.expectOne(base).flush([workspace]);
    expect(page.board()).toEqual(board);
    params.next(convertToParamMap({ workspaceId: workspace.id, boardId: 'private' }));
    fixture.detectChanges();
    expect(page.board()).toBeNull();
    http.expectOne(base).flush([workspace]);
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
    http.expectOne(base).flush([workspace]);
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
    http.expectOne(base).flush([]);
  });
});
