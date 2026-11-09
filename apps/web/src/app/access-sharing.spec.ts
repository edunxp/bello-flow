import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AccessSharing } from './access-sharing';
import { Session } from './session';

describe('AccessSharing', () => {
  const workspacePath = '/api/workspaces/workspace/members';
  const boardPath = '/api/workspaces/workspace/boards/board/members';
  const centralPath = '/api/workspaces/notifications';
  const empty = { members: [], boards: [] };

  function setup(boardId?: string, central = false) {
    const params = new BehaviorSubject(
      convertToParamMap({ workspaceId: 'workspace', ...(boardId ? { boardId } : {}) }),
    );
    TestBed.configureTestingModule({
      imports: [AccessSharing],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params, snapshot: { data: { central } } },
        },
      ],
    });
    const fixture = TestBed.createComponent(AccessSharing);
    const session = TestBed.inject(Session);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    session.signedIn({ account: { id: 'synthetic' } });
    fixture.detectChanges();
    return { fixture, session, http, page: fixture.componentInstance, params };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('renders management metadata and sends the confirmed address and role', async () => {
    const { fixture, http, page } = setup();
    const listing = {
      members: [{ email: 'owner@example.test', role: 'ADMIN' }],
      boards: [{ id: 'board', name: 'ERP' }],
    };
    http.expectOne(workspacePath).flush(listing);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Gerenciar acesso aos quadros');
    page.prepare(new Event('submit'), ' member@example.test ', 'MEMBER');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('member@example.test');
    const confirmed = page.confirm();
    await page.confirm();
    const request = http.expectOne({ url: workspacePath, method: 'POST' });
    expect(request.request.body).toEqual({ email: 'member@example.test', role: 'MEMBER' });
    expect(request.request.headers.get('X-Bello-Flow-Request')).toBe('1');
    request.flush(null);
    await Promise.resolve();
    http.expectOne({ url: workspacePath, method: 'GET' }).flush(listing);
    await confirmed;
    expect(page.message()).toBe('Acesso concedido.');
    expect(page.pending()).toBeNull();
  });

  it('offers Observer only for a board and retains the selection on a conflict', async () => {
    const { fixture, http, page } = setup('board');
    http.expectOne(boardPath).flush(empty);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Observador');
    page.prepare(new Event('submit'), 'observer@example.test', 'OBSERVER');
    const pending = page.confirm();
    http
      .expectOne({ url: boardPath, method: 'POST' })
      .flush({}, { status: 409, statusText: 'Conflict' });
    await pending;
    expect(page.message()).toContain('outro papel');
    expect(page.pending()?.role).toBe('OBSERVER');
  });

  it('renders only the Central response and removes notices after logout', () => {
    const { fixture, http, page, session } = setup(undefined, true);
    const notice = {
      id: 'notice',
      grantedRole: 'OBSERVER',
      workspaceId: 'workspace',
      boardId: 'board',
      actor: { emailKey: 'owner@example.test' },
      workspace: { name: 'Trabalho' },
      board: { name: 'ERP' },
    };
    http
      .expectOne(centralPath)
      .flush([
        notice,
        { ...notice, id: 'other', boardId: null, board: null, grantedRole: 'MEMBER' },
      ]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Observador');
    expect(fixture.nativeElement.textContent).toContain('Trabalho');
    expect(page.noticeLink(notice)).toEqual(['/workspaces', 'workspace', 'boards', 'board']);
    session.signedOut();
    fixture.detectChanges();
    expect(page.notices()).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Ir para o login');
  });

  it('clears previous participants when opening a forbidden scope', () => {
    const { http, params, fixture, page } = setup('board');
    http.expectOne(boardPath).flush(empty);
    params.next(convertToParamMap({ workspaceId: 'workspace', boardId: 'other' }));
    fixture.detectChanges();
    expect(page.participants()).toBeNull();
    http
      .expectOne('/api/workspaces/workspace/boards/other/members')
      .flush({}, { status: 403, statusText: 'Forbidden' });
    expect(page.message()).toBe('Recurso indisponível.');
  });
});
