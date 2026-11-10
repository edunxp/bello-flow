import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { HistoryPanel } from './history-panel';

describe('HistoryPanel', () => {
  const path = '/api/workspaces/work/boards/board/feed';

  function setup() {
    TestBed.configureTestingModule({
      imports: [HistoryPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(HistoryPanel);
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('title', 'Atividades');
    fixture.componentInstance.toggle(true);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const submit = () =>
      element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    return {
      fixture,
      panel: fixture.componentInstance,
      element,
      submit,
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('filters, appends pages, renders restricted markers and clears on denial', async () => {
    const { panel, element, fixture, submit, http } = setup();
    element.querySelector<HTMLInputElement>('[name=operation]')!.value = 'CARD_MOVED';
    submit();
    http
      .expectOne((req) => req.url === path && req.params.get('operation') === 'CARD_MOVED')
      .flush({
        events: [{ occurredAt: '2026-11-10T00:00:00Z', restricted: true }],
        next: { offset: 30 },
      });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element.textContent).toContain('Atividade histórica restrita');

    const more = panel.more();
    http
      .expectOne(
        (req) => req.params.get('offset') === '30' && req.params.get('operation') === 'CARD_MOVED',
      )
      .flush({
        events: [
          {
            occurredAt: '2026-11-09T00:00:00Z',
            operation: 'CARD_MOVED',
            afterData: { title: '<b>Texto</b>' },
          },
        ],
        next: null,
      });
    await more;
    fixture.detectChanges();
    expect(panel.events()).toHaveLength(2);
    expect(element.querySelector('pre b')).toBeNull();
    expect(element.querySelector('pre')?.textContent).toContain('<b>Texto</b>');

    submit();
    http.expectOne((req) => req.url === path).flush(null, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    expect(panel.events()).toHaveLength(0);
    expect(panel.message()).toContain('sem permissão');
    http.verify();
  });

  it('groups only consecutive matching feed reorders and keeps the formal audit individual', () => {
    const { panel, fixture } = setup();
    const base = {
      occurredAt: '2026-11-10T00:00:00Z',
      actorId: 'actor',
      boardId: 'board',
      listId: 'list',
    };
    panel.events.set([
      { ...base, operation: 'LIST_REORDERED' },
      { ...base, operation: 'LIST_REORDERED' },
      { ...base, operation: 'CARD_MOVED', counterpart: { boardName: 'Quadro', listId: 'list' } },
      {
        ...base,
        operation: 'CARD_MOVED',
        counterpart: { boardName: 'Quadro', listId: 'other-list' },
      },
      { ...base, operation: 'CARD_MOVED' },
    ]);
    expect(panel.entries().map(({ count }) => count)).toEqual([2, 1, 1, 1]);
    fixture.componentRef.setInput('area', 'CONTENT');
    expect(panel.entries().map(({ count }) => count)).toEqual([1, 1, 1, 1, 1]);
    panel.toggle(false);
    expect(panel.entries()).toEqual([]);
  });

  it('ignores stale success and failure and reports an empty current query', async () => {
    const { fixture, panel, submit, http } = setup();
    submit();
    const stale = http.expectOne(path);
    panel.reset();
    stale.flush({ events: [{ operation: 'STALE' }], next: null });
    await fixture.whenStable();
    expect(panel.events()).toEqual([]);

    submit();
    const failure = http.expectOne(path);
    panel.reset();
    failure.error(new ProgressEvent('network'));
    await fixture.whenStable();
    expect(panel.message()).toBe('');

    submit();
    http.expectOne(path).flush({ events: [], next: null });
    await fixture.whenStable();
    expect(panel.message()).toContain('Nenhuma atividade');
    http.verify();
  });
});
