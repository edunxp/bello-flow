import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthApi } from './auth-api';
import { Session } from './session';

describe('Session', () => {
  const identity = { account: { id: 'synthetic' } };
  let api: { session: ReturnType<typeof vi.fn> };
  let session: Session;
  beforeEach(() => {
    api = { session: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: AuthApi, useValue: api }] });
    session = TestBed.inject(Session);
  });
  it('restores identity only after server confirmation', async () => {
    api.session.mockResolvedValue(identity);
    const pending = session.restore();
    expect(session.state()).toBe('loading');
    await pending;
    expect(session.state()).toBe('authenticated');
    expect(session.identity()).toEqual(identity);
    session.signedOut();
    expect(session.identity()).toBeNull();
    expect(session.state()).toBe('anonymous');
    session.signedIn(identity);
    expect(session.state()).toBe('authenticated');
  });
  it.each([401, 403, 503, 0])('distinguishes session rejection from outage %s', async (status) => {
    api.session.mockRejectedValue(new HttpErrorResponse({ status }));
    await session.restore();
    expect(session.state()).toBe(status === 401 ? 'anonymous' : 'unavailable');
  });
  it('fails closed for an unexpected error', async () => {
    api.session.mockRejectedValue(new Error());
    await session.restore();
    expect(session.state()).toBe('unavailable');
  });
  it.each([true, false])(
    'ignores stale restore after a newer session transition (%s)',
    async (success) => {
      let resolve!: (value: typeof identity) => void;
      let reject!: (error: unknown) => void;
      api.session.mockReturnValue(
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
      );
      const pending = session.restore();
      session.signedIn(identity);
      if (success) resolve({ account: { id: 'old' } });
      else reject(new Error());
      await pending;
      expect(session.identity()).toEqual(identity);
    },
  );
});
