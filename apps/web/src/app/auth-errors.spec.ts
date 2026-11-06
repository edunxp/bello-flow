import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { failureMessage, retrySeconds, validPassword } from './auth-errors';
describe('safe errors and password policy', () => {
  it.each([400, 401, 403, 415, 429, 500, 503, 0])(
    'maps %s without reflecting server content',
    (status) => {
      const error = new HttpErrorResponse({ status, error: { message: 'sensitive sentinel' } });
      expect(failureMessage(error, 'login')).not.toContain('sensitive');
      expect(failureMessage(error, 'reset')).toBeTruthy();
    },
  );
  it('handles non HTTP errors', () =>
    expect(failureMessage(new Error(), 'logout')).toContain('conexão'));
  it.each(['1', '30', '0', '-1', '1.5', 'abc', '9007199254740992', ''])(
    'validates Retry-After %s',
    (value) => {
      const error = new HttpErrorResponse({
        status: 429,
        headers: new HttpHeaders({ 'Retry-After': value }),
      });
      expect(retrySeconds(error)).toBe(value === '1' || value === '30' ? Number(value) : 0);
    },
  );
  it('does not apply a missing or unrelated Retry-After', () => {
    expect(retrySeconds(new Error())).toBe(0);
    expect(retrySeconds(new HttpErrorResponse({ status: 503 }))).toBe(0);
    expect(retrySeconds(new HttpErrorResponse({ status: 429 }))).toBe(0);
  });
  it.each([
    ['a'.repeat(11), false],
    ['a'.repeat(12), true],
    ['😀'.repeat(128), true],
    ['a'.repeat(129), false],
    ['a'.repeat(12) + '\uD800', false],
    ['a'.repeat(12) + '\uDC00', false],
  ])('counts Unicode points and rejects malformed input', (value, valid) => {
    expect(validPassword(value as string)).toBe(valid);
  });
});
