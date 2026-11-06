import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { AuthPage } from './auth-page';
import { AuthApi } from './auth-api';
import { Session } from './session';
import { ResetToken } from './reset-token';

describe('Auth forms', () => {
  const identity = { account: { id: 'synthetic' } };
  let api: {
    login: ReturnType<typeof vi.fn>;
    recover: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    session: ReturnType<typeof vi.fn>;
  };
  let vault: { read: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  function setup(mode: string, token = 'synthetic-token') {
    api = {
      login: vi.fn().mockResolvedValue(identity),
      recover: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
      session: vi.fn().mockRejectedValue(new HttpErrorResponse({ status: 401 })),
    };
    vault = { read: vi.fn().mockReturnValue(token), clear: vi.fn() };
    TestBed.configureTestingModule({
      imports: [AuthPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { mode } } } },
        { provide: AuthApi, useValue: api },
        { provide: ResetToken, useValue: vault },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(AuthPage);
    fixture.detectChanges();
    return { fixture, page: fixture.componentInstance };
  }
  afterEach(() => {
    vi.useRealTimers();
  });
  it('logs in, updates identity and clears password', async () => {
    const { page, fixture } = setup('login');
    page.email = 'test@example.invalid';
    page.password = 'synthetic-password';
    await page.submit();
    fixture.detectChanges();
    expect(api.login).toHaveBeenCalledWith(page.email, 'synthetic-password');
    expect(TestBed.inject(Session).state()).toBe('authenticated');
    expect(page.password).toBe('');
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/');
    expect(fixture.nativeElement.textContent).toContain('sessão ativa');
  });
  it('shows recovery confirmation without asserting delivery', async () => {
    const { page, fixture } = setup('recover');
    await page.submit();
    fixture.detectChanges();
    expect(page.done()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Se houver uma conta elegível');
    await page.submit();
    expect(api.recover).toHaveBeenCalledTimes(1);
  });
  it('resets and rechecks session without automatically logging in or out', async () => {
    const { page, fixture } = setup('reset');
    page.password = page.confirmation = 'synthetic-password';
    await page.submit();
    fixture.detectChanges();
    expect(api.reset).toHaveBeenCalledWith('synthetic-token', 'synthetic-password');
    expect(vault.clear).toHaveBeenCalled();
    expect(api.session).toHaveBeenCalledOnce();
    expect(page.done()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Senha redefinida');
  });
  it.each([
    ['short', 'short'],
    ['synthetic-password', 'different'],
  ])('validates reset locally', async (password, confirmation) => {
    const { page } = setup('reset');
    page.password = password;
    page.confirmation = confirmation;
    await page.submit();
    expect(api.reset).not.toHaveBeenCalled();
    expect(page.message()).toContain('confirme');
  });
  it('offers a new link when token is missing', async () => {
    const { page, fixture } = setup('reset', '');
    await page.submit();
    expect(api.reset).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('reabra o link original');
  });
  it.each(['login', 'recover', 'reset'])(
    'renders editable %s and maps service failures',
    async (mode) => {
      const { page, fixture } = setup(mode);
      page.password = page.confirmation = 'synthetic-password';
      api.login.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
      api.recover.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
      api.reset.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
      await page.submit();
      fixture.detectChanges();
      expect(page.message()).toContain('pendente');
      expect(page.busy()).toBe(false);
      expect(fixture.nativeElement.querySelector('form').getAttribute('aria-busy')).toBe('false');
    },
  );
  it('blocks duplicate submissions and respects Retry-After without retrying', async () => {
    vi.useFakeTimers();
    const { page, fixture } = setup('login');
    api.login.mockRejectedValue(
      new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '2' }) }),
    );
    const pending = page.submit();
    await page.submit();
    await pending;
    fixture.detectChanges();
    expect(api.login).toHaveBeenCalledOnce();
    expect(page.remaining()).toBe(2);
    await page.submit();
    expect(api.login).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(page.remaining()).toBe(0);
    expect(api.login).toHaveBeenCalledOnce();
  });
  it.each(['login', 'recover', 'reset'])(
    'ignores late %s success after navigation',
    async (mode) => {
      const { page } = setup(mode);
      let resolve!: (value: typeof identity) => void;
      const delayed = new Promise<typeof identity>((yes) => {
        resolve = yes;
      });
      api.login.mockReturnValue(delayed);
      api.recover.mockReturnValue(delayed);
      api.reset.mockReturnValue(delayed);
      page.password = page.confirmation = 'synthetic-password';
      const pending = page.submit();
      page.ngOnDestroy();
      resolve(identity);
      await pending;
      expect(page.done()).toBe(false);
      expect(TestBed.inject(Session).state()).toBe('loading');
    },
  );
  it('ignores late failure after navigation', async () => {
    const { page } = setup('login');
    let reject!: (error: unknown) => void;
    api.login.mockReturnValue(
      new Promise((_, no) => {
        reject = no;
      }),
    );
    const pending = page.submit();
    page.ngOnDestroy();
    reject(new Error());
    await pending;
    expect(page.message()).toBe('');
  });
  it('announces missing required fields without making an HTTP call', async () => {
    const { page, fixture } = setup('login');
    await fixture.whenStable();
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(page.message()).toContain('campos obrigatórios');
    expect(api.login).not.toHaveBeenCalled();
  });
  it('submits through the real form binding', async () => {
    const { page, fixture } = setup('recover');
    page.email = 'test@example.invalid';
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(api.recover).toHaveBeenCalledWith(page.email);
  });
});
