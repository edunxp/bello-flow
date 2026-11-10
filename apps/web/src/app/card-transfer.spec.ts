import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CardTransfer } from './card-transfer';

describe('CardTransfer', () => {
  const boardPath = '/api/workspaces/work/boards/from';
  const path = boardPath + '/lists/list/cards/card/transfer';

  function setup() {
    TestBed.configureTestingModule({
      imports: [CardTransfer],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(CardTransfer);
    fixture.componentRef.setInput('boardPath', boardPath);
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('cardId', 'card');
    fixture.detectChanges();
    return {
      fixture,
      panel: fixture.componentInstance,
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('confirms the displayed impact and retains the same request on uncertain failure', async () => {
    const { fixture, panel, http } = setup();
    const moved = vi.fn();
    panel.moved.subscribe(moved);
    panel.confirm();
    const opening = panel.open();
    await panel.open();
    http
      .expectOne(boardPath + '/transfer-targets')
      .flush([{ id: 'to', name: 'Destino', lists: [{ id: 'list', name: 'Entrada' }] }]);
    await opening;

    const event = new Event('submit', { cancelable: true });
    const preview = panel.preview(event, 'to/list');
    expect(event.defaultPrevented).toBe(true);
    http
      .expectOne((req) => req.url === path && req.params.get('destinationBoardId') === 'to')
      .flush({
        impact: 'review',
        incompatible: [{ accountId: 'a', email: 'a@example.invalid' }],
      });
    await preview;
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('a@example.invalid');

    const failed = panel.confirm();
    const request = http.expectOne({ url: path, method: 'POST' });
    request.error(new ProgressEvent('network'));
    await failed;
    expect(panel.message()).toContain('Não foi possível');
    const confirmed = panel.confirm();
    const replay = http.expectOne({ url: path, method: 'POST' });
    expect(replay.request.body).toEqual(request.request.body);
    replay.flush(null);
    await confirmed;
    expect(moved).toHaveBeenCalledOnce();
    expect(panel.targets()).toBeNull();
    http.verify();
  });
});
