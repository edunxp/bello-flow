import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CardComments } from './card-comments';

describe('CardComments', () => {
  const path = '/api/workspaces/work/boards/board/lists/list/cards/card/comments';
  const comment = {
    id: 'comment',
    author: 'author@example.test',
    content: '<strong>Texto</strong>',
    version: 'v1',
    createdAt: '2026-11-09T12:00:00Z',
    editedAt: null,
    removedAt: null,
    removedBy: null,
    canEdit: true,
    canModerate: false,
  };
  const thread = { editable: true, comments: [comment] };

  function setup(data: NonNullable<ReturnType<CardComments['thread']>> = thread) {
    TestBed.configureTestingModule({
      imports: [CardComments],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(CardComments);
    fixture.componentRef.setInput('path', path);
    fixture.componentRef.setInput('cardId', 'card');
    fixture.componentRef.setInput('revision', 1);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne({ url: path, method: 'GET' }).flush(data);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const click = (label: string) =>
      [...element.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === label)!
        .click();
    const form = (label: string, value: string) => {
      const input = [...element.querySelectorAll('label')].find(
        (node) => node.textContent?.trim() === label,
      )!.control as HTMLTextAreaElement;
      input.value = value;
      input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    };
    const reload = async (next = data) => {
      await Promise.resolve();
      await Promise.resolve();
      fixture.detectChanges();
      http.expectOne({ url: path, method: 'GET' }).flush(next);
      fixture.detectChanges();
    };
    return { fixture, http, page: fixture.componentInstance, element, click, form, reload };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('renders text safely and lets authors create, edit and remove', async () => {
    const { http, fixture, page, element, form, click, reload } = setup();
    expect(element.querySelector('.comment-text strong')).toBeNull();
    expect(element.textContent).toContain('<strong>Texto</strong>');
    form('Novo comentário', 'Novo');
    const creation = http.expectOne({ url: path, method: 'POST' });
    expect(creation.request.body).toMatchObject({
      kind: 'CREATE',
      content: 'Novo',
      operationId: expect.any(String),
    });
    creation.error(new ProgressEvent('network'));
    await reload();
    form('Novo comentário', 'Novo');
    const replay = http.expectOne({ url: path, method: 'POST' });
    expect(replay.request.body).toEqual(creation.request.body);
    replay.flush({}, { status: 409, statusText: 'Conflict' });
    await reload();
    expect(element.querySelector<HTMLTextAreaElement>('#comment-new-card')?.value).toBe('');
    expect(page.message()).toContain('pode ter sido registrado');

    click('Editar comentário');
    fixture.detectChanges();
    form('Editar comentário', 'Revisado');
    const edit = http.expectOne({ url: path, method: 'POST' });
    expect(edit.request.body).toMatchObject({
      kind: 'EDIT',
      id: comment.id,
      version: 'v1',
      content: 'Revisado',
    });
    edit.flush(null);
    await reload();
    click('Remover comentário');
    fixture.detectChanges();
    click('Cancelar');
    fixture.detectChanges();
    click('Remover comentário');
    fixture.detectChanges();
    click('Confirmar remoção');
    const remove = http.expectOne({ url: path, method: 'POST' });
    expect(remove.request.body).toMatchObject({ kind: 'REMOVE', confirmed: true });
    remove.flush(null);
    await reload({ editable: true, comments: [] });
    expect(page.pending()).toBeNull();
    expect(element.textContent).toContain('Nenhum comentário');
  });

  it('requires a moderation reason and discards a stale draft after permission changes', async () => {
    const other = {
      ...comment,
      canEdit: false,
      canModerate: true,
      editedAt: '2026-11-09T13:00:00Z',
    };
    const { http, fixture, page, element, click, form } = setup({
      editable: true,
      comments: [other],
    });
    expect(element.textContent).toContain('Editado');
    click('Moderar comentário');
    fixture.detectChanges();
    form('Justificativa de moderação', 'Razão');
    const moderation = http.expectOne({ url: path, method: 'POST' });
    expect(moderation.request.body).toMatchObject({
      kind: 'MODERATE',
      justification: 'Razão',
      confirmed: true,
    });
    moderation.flush({}, { status: 400, statusText: 'Bad Request' });
    await Promise.resolve();
    expect(page.message()).toContain('Confira o texto');
    expect(page.pending()).not.toBeNull();

    fixture.componentRef.setInput('revision', 2);
    fixture.detectChanges();
    http.expectOne(path).flush({
      editable: false,
      comments: [
        {
          ...other,
          content: null,
          removedAt: '2026-11-09T14:00:00Z',
          removedBy: 'moderator@example.test',
          version: null,
          canModerate: false,
        },
      ],
    });
    fixture.detectChanges();
    expect(page.pending()).toBeNull();
    expect(element.textContent).toContain('Comentário removido');
    expect(element.textContent).toContain('moderator@example.test');
    expect(element.querySelector('textarea')).toBeNull();

    fixture.componentRef.setInput('revision', 3);
    fixture.detectChanges();
    http.expectOne(path).flush({}, { status: 404, statusText: 'Not Found' });
    expect(page.thread()).toBeNull();
  });
});
