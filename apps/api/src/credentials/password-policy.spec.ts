import { assertValidPassword, PasswordPolicyError } from './password-policy.js';

describe('password policy', () => {
  it.each([
    ['11 code points', 'a'.repeat(11)],
    ['129 code points', 'a'.repeat(129)],
    ['empty password', ''],
  ])('rejects %s', (_description, password) => {
    expect(() => assertValidPassword(password)).toThrow(PasswordPolicyError);
  });

  it.each([
    ['12 code points', 'a'.repeat(12)],
    ['128 code points', 'a'.repeat(128)],
  ])('accepts %s', (_description, password) => {
    expect(() => assertValidPassword(password)).not.toThrow();
  });

  it('counts Unicode code points instead of UTF-16 code units', () => {
    const password = '🚀'.repeat(12);

    expect(password).toHaveLength(24);
    expect(() => assertValidPassword(password)).not.toThrow();
  });

  it.each([
    ['isolated high surrogate', `valid-prefix-${'\ud800'}`],
    ['isolated low surrogate', `valid-prefix-${'\udc00'}`],
    [
      'high surrogate followed by a non-low surrogate',
      `valid-${'\ud800'}x-value`,
    ],
  ])('rejects malformed Unicode: %s', (_description, password) => {
    expect(() => assertValidPassword(password)).toThrow(PasswordPolicyError);
  });

  it('keeps spaces significant and applies no composition rules', () => {
    expect(() => assertValidPassword(' '.repeat(12))).not.toThrow();
    expect(() => assertValidPassword(' '.repeat(11))).toThrow(
      PasswordPolicyError,
    );
  });

  it.each([undefined, null, 12, true, {}, []])(
    'rejects non-string input %#',
    (password) => {
      expect(() => assertValidPassword(password)).toThrow(PasswordPolicyError);
    },
  );

  it('does not include the rejected password in the error', () => {
    const password = 'sensitive';

    expect(() => assertValidPassword(password)).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(password),
      }),
    );
  });
});
