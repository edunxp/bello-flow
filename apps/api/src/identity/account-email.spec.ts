import { normalizeAccountEmail } from './account-email.js';

describe('account email normalization', () => {
  it.each([
    ['simple@example.com', 'simple@example.com', 'simple@example.com'],
    [
      ' User.Name+tag@Example.COM ',
      'User.Name+tag@Example.COM',
      'user.name+tag@example.com',
    ],
    [
      'user@xn--bcher-kva.example',
      'user@xn--bcher-kva.example',
      'user@xn--bcher-kva.example',
    ],
  ])('normalizes the PostgreSQL-compatible email %s', (input, email, key) => {
    expect(normalizeAccountEmail(input)).toEqual({
      status: 'VALID',
      email,
      emailKey: key,
    });
  });

  it.each([
    null,
    undefined,
    42,
    '',
    '   ',
    '\tuser@example.com',
    'user@example.com\n',
    'user..name@example.com',
    '.user@example.com',
    'user.@example.com',
    'user@example',
    'user@[127.0.0.1]',
    '"user"@example.com',
    'usér@example.com',
    `${'a'.repeat(65)}@example.com`,
    `${'a'.repeat(244)}@example.com`,
  ])('rejects the PostgreSQL-incompatible value %s', (input) => {
    expect(normalizeAccountEmail(input)).toEqual({ status: 'INVALID' });
  });

  it('removes only ASCII U+0020 spaces', () => {
    expect(normalizeAccountEmail(' user@example.com ')).toMatchObject({
      status: 'VALID',
      email: 'user@example.com',
    });
    expect(normalizeAccountEmail('\u00a0user@example.com\u00a0')).toEqual({
      status: 'INVALID',
    });
  });
});
