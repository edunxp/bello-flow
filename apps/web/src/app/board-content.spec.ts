import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BoardContent } from './board-content';

describe('BoardContent', () => {
  const path = '/api/workspaces/work/boards/board/lists';
  const key = 'bello.pending-create:synthetic:' + path;
  const lists = [
    {
      id: 'list',
      name: 'A fazer',
      cards: [{ id: 'card', title: 'Cartão', description: 'Conteúdo' }],
    },
  ];

  function setup(editable = true) {
    TestBed.configureTestingModule({
      imports: [BoardContent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(BoardContent);
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('accountId', 'synthetic');
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne({ url: path, method: 'GET' }).flush({ editable, lists });
    fixture.detectChanges();
    return { fixture, http, page: fixture.componentInstance };
  }

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    sessionStorage.clear();
  });

  it('renders content and omits the write controls for observers', () => {
    const { fixture } = setup(false);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Conteúdo');
    expect(element.querySelector('form')).toBeNull();
  });

  it('reuses a pending creation after a lost response and reloads after success', async () => {
    const { fixture, http, page } = setup();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('#new-list-name')!;
    const form = input.form!;
    input.value = 'Concluído';
    const send = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
    send();
    send();
    const first = http.expectOne({ url: path, method: 'POST' });
    first.error(new ProgressEvent('network'));
    await fixture.whenStable();
    expect(page.message()).toContain('Repita com os mesmos dados');
    expect(sessionStorage.getItem(key)).toBe(first.request.body.operationId);

    send();
    const replay = http.expectOne({ url: path, method: 'POST' });
    expect(replay.request.body).toEqual(first.request.body);
    replay.flush({ id: 'new-list' });
    await Promise.resolve();
    fixture.detectChanges();
    http.expectOne({ url: path, method: 'GET' }).flush({ editable: true, lists });
    expect(input.value).toBe('');
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it('uses PATCH for editing and handles validation and revoked access', async () => {
    const { fixture, http, page } = setup();
    const suffix = '/list/cards/card';
    const event = new Event('submit');
    const edit = () => page.save(event, suffix, { title: 'Novo' }, false);
    let pending = edit();
    http
      .expectOne({ url: path + suffix, method: 'PATCH' })
      .flush({}, { status: 400, statusText: 'Bad Request' });
    await pending;
    expect(page.message()).toContain('Confira os campos');
    pending = edit();
    http
      .expectOne({ url: path + suffix, method: 'PATCH' })
      .flush({}, { status: 403, statusText: 'Forbidden' });
    await pending;
    fixture.detectChanges();
    http
      .expectOne({ url: path, method: 'GET' })
      .flush({}, { status: 404, statusText: 'Not Found' });
    expect(page.content()).toBeNull();
  });
  it('sends only changed card fields and reloads when the edit is uncertain', async () => {
    const { fixture, http, page } = setup();
    const element = fixture.nativeElement as HTMLElement;
    const title = element.querySelector<HTMLInputElement>('#title-card')!;
    const form = title.form!;
    const send = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
    send();
    http.expectNone(path + '/list/cards/card');
    title.value = 'Novo título';
    send();
    const patch = http.expectOne({ method: 'PATCH', url: path + '/list/cards/card' });
    expect(JSON.parse(patch.request.serializeBody() as string)).toEqual({ title: 'Novo título' });
    patch.error(new ProgressEvent('network'));
    await Promise.resolve();
    expect(page.content()).toBeNull();
    expect(page.message()).toContain('Confira o conteúdo atualizado');
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: path }).flush({ editable: true, lists });
  });

  it('reloads after a conflicting card creation without submitting it again', async () => {
    const { fixture, http, page } = setup();
    const element = fixture.nativeElement as HTMLElement;
    const title = element.querySelector<HTMLInputElement>('#new-title-list')!;
    title.value = 'Novo cartão';
    title.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    const cardPath = path + '/list/cards';
    const request = http.expectOne({ method: 'POST', url: cardPath });
    const cardKey = 'bello.pending-create:synthetic:' + cardPath;
    expect(sessionStorage.getItem(cardKey)).toBe(request.request.body.operationId);
    request.flush({}, { status: 409, statusText: 'Conflict' });
    await Promise.resolve();
    expect(sessionStorage.getItem(cardKey)).toBeNull();
    expect(page.message()).toContain('criação anterior');
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: path }).flush({ editable: true, lists });
  });
});
