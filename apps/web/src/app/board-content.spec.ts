import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BoardContent } from './board-content';

describe('BoardContent', () => {
  const path = '/api/workspaces/work/boards/board/lists';
  const key = 'bello.pending-create:synthetic:' + path;
  const unscheduled = {
    startDate: null,
    dueDate: null,
    completedAt: null,
    completedById: null,
    overdue: false,
  };
  const calendar = { timeZone: 'America/Sao_Paulo', today: '2026-11-09' };
  const lists = [
    {
      id: 'list',
      name: 'A fazer',
      positionRevision: 0,
      cardOrderRevision: 1,
      cards: [
        {
          ...unscheduled,
          id: 'card',
          title: 'Cartão',
          description: 'Conteúdo',
          positionRevision: 0,
        },
      ],
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
  it('reorders lists with buttons and moves a card with drag and drop', async () => {
    const { fixture, http, page } = setup();
    const [first] = lists;
    const second = {
      id: 'second',
      name: 'Em andamento',
      positionRevision: 1,
      cardOrderRevision: 0,
      cards: [],
    };
    const state = {
      ...calendar,
      editable: true,
      orderRevision: 2,
      syncRevision: 3,
      lists: [first, second],
    };
    page.content.set(state);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const buttons = () => [...element.querySelectorAll('button')];
    const button = (text: string) => buttons().find((value) => value.textContent?.trim() === text)!;
    button('Descer lista').click();
    const move = http.expectOne({ url: path + '/move', method: 'POST' });
    expect(move.request.body).toMatchObject({
      kind: 'LIST',
      itemId: 'list',
      sourceId: 'board',
      destinationId: 'board',
      destinationRevision: 2,
      itemRevision: 0,
      leftId: 'second',
      rightId: null,
    });
    move.flush(null, { status: 204, statusText: 'No Content' });
    await Promise.resolve();
    fixture.detectChanges();
    http.expectOne(path).flush(state);

    const card = first.cards[0];
    const transfer = { setData: vi.fn() };
    const event = { dataTransfer: transfer, preventDefault: vi.fn() } as unknown as DragEvent;
    page.startDrag(event, first, card);
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', card.id);
    fixture.detectChanges();
    page.allowDrop(event, 'CARD');
    page.drop(event, 'CARD', second, null);
    const drop = http.expectOne({ url: path + '/move', method: 'POST' });
    expect(drop.request.body).toMatchObject({
      kind: 'CARD',
      sourceId: 'list',
      destinationId: 'second',
      leftId: null,
      rightId: null,
    });
    drop.flush({}, { status: 409, statusText: 'Conflict' });
    await Promise.resolve();
    expect(page.message()).toContain('Confira a ordem atualizada');
    fixture.detectChanges();
    http.expectOne(path).flush(state);

    const select = element.querySelector<HTMLSelectElement>('#move-card')!;
    select.value = 'second';
    button('Mover cartão').click();
    http.expectOne({ url: path + '/move', method: 'POST' }).flush(null);
    await Promise.resolve();
    fixture.detectChanges();
    http.expectOne(path).flush(state);
  });

  it('refreshes on a newer revision and stops checking after losing access', async () => {
    vi.useFakeTimers();
    try {
      const { fixture, http, page } = setup(false);
      await vi.advanceTimersByTimeAsync(5000);
      http.expectOne(path + '/revision').flush({ syncRevision: 1 });
      fixture.detectChanges();
      const previous = http.expectOne(path);
      await vi.advanceTimersByTimeAsync(5000);
      http.expectOne(path + '/revision').flush({ syncRevision: 2 });
      fixture.detectChanges();
      expect(previous.cancelled).toBe(true);
      const inFlight = http.expectOne(path);
      await vi.advanceTimersByTimeAsync(5000);
      http.expectOne(path + '/revision').flush({}, { status: 403, statusText: 'Forbidden' });
      inFlight.flush({ editable: false, lists, syncRevision: 2 });
      expect(page.content()).toBeNull();
      await vi.advanceTimersByTimeAsync(10000);
      http.expectNone(path + '/revision');
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
  it('wires the list and card drag targets and keyboard alternatives', async () => {
    const { fixture, http, page } = setup();
    const first = {
      ...lists[0],
      cards: [
        lists[0].cards[0],
        {
          ...unscheduled,
          ...unscheduled,
          id: 'second-card',
          title: 'Outro',
          description: null,
          positionRevision: 0,
        },
      ],
    };
    const second = {
      id: 'second',
      name: 'Próxima',
      positionRevision: 0,
      cardOrderRevision: 0,
      cards: [],
    };
    const state = {
      ...calendar,
      editable: true,
      orderRevision: 2,
      syncRevision: 3,
      lists: [first, second],
    };
    page.content.set(state);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const target = (selector: string, label: string) =>
      [...element.querySelectorAll<HTMLElement>(selector)].find(
        (node) => node.textContent?.trim() === label,
      )!;
    const event = (node: HTMLElement, name: string) =>
      node.dispatchEvent(new Event(name, { cancelable: true, bubbles: true }));
    const confirm = async () => {
      http.expectOne({ url: path + '/move', method: 'POST' }).flush(null);
      await Promise.resolve();
      fixture.detectChanges();
      http.expectOne(path).flush(state);
      fixture.detectChanges();
    };

    const list = target('button', 'Arrastar lista A fazer');
    const listTarget = target('button', 'Arrastar lista Próxima');
    event(list, 'dragstart');
    fixture.detectChanges();
    event(listTarget, 'dragover');
    event(listTarget, 'drop');
    event(list, 'dragend');
    http.expectNone(path + '/move');
    event(list, 'dragstart');
    fixture.detectChanges();
    const listEnd = target('.drop-zone', 'Soltar no fim do quadro');
    event(listEnd, 'dragover');
    event(listEnd, 'drop');
    await confirm();

    const card = target('button', 'Arrastar cartão Outro');
    const cardTarget = target('button', 'Arrastar cartão Cartão');
    event(card, 'dragstart');
    fixture.detectChanges();
    event(cardTarget, 'dragover');
    event(cardTarget, 'drop');
    event(card, 'dragend');
    await confirm();
    event(card, 'dragstart');
    fixture.detectChanges();
    const cardEnd = target('.drop-zone', 'Soltar no fim de Próxima');
    event(cardEnd, 'dragover');
    event(cardEnd, 'drop');
    await confirm();
    const enabled = (label: string) =>
      [...element.querySelectorAll<HTMLButtonElement>('button')].find(
        (node) => node.textContent?.trim() === label && !node.disabled,
      )!;
    for (const label of ['Subir lista', 'Subir cartão', 'Descer cartão']) {
      enabled(label).click();
      await confirm();
    }
  });
  it('validates civil dates and submits a complete date pair', async () => {
    const { fixture, http, page } = setup();
    const [list] = lists;
    const [card] = list.cards;
    const pathToSchedule = path + '/list/cards/card/schedule';
    page.saveDates(new Event('submit'), list, card, '2026-11-11', '2026-11-10');
    expect(page.message()).toContain('posterior');
    page.saveDates(new Event('submit'), list, card, '', '');
    http.expectNone(pathToSchedule);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const due = element.querySelector<HTMLInputElement>('#due-card')!;
    due.value = '2026-11-10';
    due.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    const update = http.expectOne(pathToSchedule);
    expect(update.request.body).toMatchObject({
      startDate: null,
      dueDate: '2026-11-10',
      operationId: expect.any(String),
    });
    update.flush({}, { status: 400, statusText: 'Bad Request' });
    await Promise.resolve();
    expect(page.message()).toContain('Confira as datas');
    fixture.detectChanges();
    http.expectOne(path).flush({ ...calendar, editable: true, lists });
  });

  it('toggles completion and displays the confirmed time in the workspace zone', async () => {
    const { fixture, http, page } = setup();
    const element = fixture.nativeElement as HTMLElement;
    const click = (label: string) =>
      [...element.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === label)!
        .click();
    click('Concluir cartão');
    http.expectOne(path + '/list/cards/card/schedule').flush(null);
    await Promise.resolve();
    fixture.detectChanges();
    const [list] = lists;
    const completed = {
      ...list.cards[0],
      startDate: '2026-11-08',
      dueDate: '2026-11-09',
      completedAt: '2026-11-10T02:00:00.000Z',
      completedById: 'synthetic',
    };
    http
      .expectOne(path)
      .flush({ ...calendar, editable: true, lists: [{ ...list, cards: [completed] }] });
    fixture.detectChanges();
    expect(element.textContent).toContain('Concluído em 09/11/2026');
    expect(element.textContent).toContain('por você');
    click('Reabrir cartão');
    const reopen = http.expectOne(path + '/list/cards/card/schedule');
    expect(reopen.request.body.completed).toBe(false);
    reopen.error(new ProgressEvent('network'));
    await Promise.resolve();
    expect(page.message()).toContain('estado atualizado');
    fixture.detectChanges();
    http.expectOne(path).flush({ ...calendar, editable: true, lists });
  });
});
