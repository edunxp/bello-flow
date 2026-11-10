import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Session } from './session';
import { WorkspaceLabels } from './workspace-labels';

describe('WorkspaceLabels', () => {
  const path = '/api/workspaces/work/labels';
  const label = { id: 'label', name: 'Urgente', color: '#112233' };
  const editable = { editable: true, labels: [label] };

  function setup() {
    const params = new BehaviorSubject(convertToParamMap({ workspaceId: 'work' }));
    TestBed.configureTestingModule({
      imports: [WorkspaceLabels],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    });
    const fixture = TestBed.createComponent(WorkspaceLabels);
    const session = TestBed.inject(Session);
    session.signedIn({ account: { id: 'actor' } });
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    return { fixture, http, page: fixture.componentInstance, session, params };
  }

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('renders a read-only catalog and clears data on account change', () => {
    const { fixture, http, page, session } = setup();
    http.expectOne(path).flush({ ...editable, editable: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain(label.name);
    expect(element.querySelector('form')).toBeNull();
    session.signedIn({ account: { id: 'other' } });
    fixture.detectChanges();
    expect(page.catalog()).toBeNull();
    http.expectOne(path).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(page.message()).toContain('indisponível');
  });

  it('creates and edits through the form and confirms deletion', async () => {
    const { fixture, http, page } = setup();
    http.expectOne(path).flush(editable);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const reload = async () => {
      await Promise.resolve();
      fixture.detectChanges();
      http.expectOne(path).flush(editable);
      fixture.detectChanges();
    };
    const input = element.querySelector<HTMLInputElement>('#new-label-name')!;
    input.value = ' Teste ';
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    const create = http.expectOne({ url: path, method: 'POST' });
    expect(create.request.body).toMatchObject({
      name: 'Teste',
      color: null,
      operationId: expect.any(String),
    });
    create.flush(label);
    await reload();
    expect(page.message()).toBe('Catálogo atualizado.');

    const edit = element.querySelector<HTMLInputElement>('#name-label')!;
    edit.value = 'Outro';
    edit.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectOne({ url: path + '/label', method: 'PATCH' }).flush(label);
    await reload();

    const click = (name: string) =>
      [...element.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === name)!
        .click();
    click('Excluir Urgente');
    fixture.detectChanges();
    expect(element.textContent).toContain('histórico será preservado');
    click('Cancelar');
    fixture.detectChanges();
    click('Excluir Urgente');
    fixture.detectChanges();
    click('Confirmar exclusão');
    const remove = http.expectOne({ url: path + '/label/delete', method: 'POST' });
    expect(remove.request.body).toMatchObject({ name: 'Urgente', confirmed: true });
    remove.flush({}, { status: 409, statusText: 'Conflict' });
    await reload();
    expect(page.message()).toContain('a etiqueta mudou');
  });
  it('reuses an uncertain operation identity when the same form is submitted again', async () => {
    const { fixture, http, page } = setup();
    http.expectOne(path).flush(editable);
    const submit = () => page.save(new Event('submit'), 'Nova', '');
    let pending = submit();
    const first = http.expectOne({ url: path, method: 'POST' });
    first.error(new ProgressEvent('network'));
    await pending;
    fixture.detectChanges();
    http.expectOne(path).flush(editable);
    pending = submit();
    const repeat = http.expectOne({ url: path, method: 'POST' });
    expect(repeat.request.body).toEqual(first.request.body);
    repeat.flush({}, { status: 409, statusText: 'Conflict' });
    await pending;
    fixture.detectChanges();
    http.expectOne(path).flush(editable);
    pending = submit();
    const invalid = http.expectOne({ url: path, method: 'POST' });
    expect(invalid.request.body.operationId).not.toBe(first.request.body.operationId);
    invalid.flush({}, { status: 400, statusText: 'Bad Request' });
    await pending;
    fixture.detectChanges();
    http.expectNone(path);
    expect(page.message()).toContain('Confira o nome e a cor');
  });
  it('prevents writes in read-only catalogs and clears the view on logout', async () => {
    const { fixture, http, page, session } = setup();
    http.expectOne(path).flush({ labels: [], editable: false });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Nenhuma etiqueta');
    await page.save(new Event('submit'), 'Negada', '');
    http.expectNone(path);
    session.signedOut();
    fixture.detectChanges();
    expect(element.textContent).toContain('Ir para o login');
    expect(page.catalog()).toBeNull();
  });

  it('suppresses duplicate submissions and ignores a late response in another workspace', async () => {
    const { fixture, http, page, params } = setup();
    http.expectOne(path).flush(editable);
    const save = () => page.save(new Event('submit'), 'Nova', '');
    const pending = save();
    await save();
    const post = http.expectOne({ url: path, method: 'POST' });
    params.next(convertToParamMap({ workspaceId: 'other' }));
    fixture.detectChanges();
    const nextPath = '/api/workspaces/other/labels';
    http.expectOne(nextPath).flush({ editable: true, labels: [] });
    post.flush(label);
    await pending;
    expect(page.catalog()?.labels).toEqual([]);
    expect(page.message()).toBe('');
    http.expectNone(nextPath);
  });
});
