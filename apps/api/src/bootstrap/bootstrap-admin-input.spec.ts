import {
  BootstrapInputValidationError,
  validateAuthorizationReference,
  validateEmail,
  validateFirstName,
  validateInstallationReference,
  validateLastName,
  validateOperatorReference,
} from './bootstrap-admin-input.js';

describe('bootstrap administrative input', () => {
  it('trims only ASCII edge spaces from names and references', () => {
    expect(validateFirstName('  Ada  ')).toBe('Ada');
    expect(validateLastName('  Lovelace  ')).toBe('Lovelace');
    expect(validateOperatorReference('  operator  ')).toBe('operator');
    expect(validateAuthorizationReference('  authorization  ')).toBe(
      'authorization',
    );
    expect(validateInstallationReference('  installation  ')).toBe(
      'installation',
    );
  });

  it.each([
    ['first name empty', () => validateFirstName('   ')],
    ['first name too long', () => validateFirstName('a'.repeat(101))],
    ['last name too long', () => validateLastName('a'.repeat(101))],
    ['name with control', () => validateFirstName('Ada\u0000')],
    ['operator empty', () => validateOperatorReference('')],
    ['operator too long', () => validateOperatorReference('o'.repeat(101))],
    [
      'authorization too long',
      () => validateAuthorizationReference('a'.repeat(201)),
    ],
    [
      'installation too long',
      () => validateInstallationReference('i'.repeat(101)),
    ],
    [
      'reference with control',
      () => validateInstallationReference('line\nbreak'),
    ],
    ['malformed Unicode', () => validateLastName(`valid-${'\ud800'}`)],
    ['isolated low surrogate', () => validateLastName(`valid-${'\udc00'}`)],
  ])('rejects %s', (_description, validation) => {
    expect(validation).toThrow(BootstrapInputValidationError);
  });

  it('counts non-BMP names as code points', () => {
    expect(validateFirstName('🚀'.repeat(100))).toBe('🚀'.repeat(100));
  });

  it.each([
    'simple@example.com',
    'User.Name+tag@Example.COM',
    'user@xn--bcher-kva.example',
  ])('accepts supported email %s', (email) => {
    expect(validateEmail(` ${email} `)).toBe(email);
  });

  it.each([
    '',
    'user..name@example.com',
    '.user@example.com',
    'user.@example.com',
    'user@example',
    'user@[127.0.0.1]',
    '"user"@example.com',
    'usér@example.com',
    `${'a'.repeat(65)}@example.com`,
    `${'a'.repeat(243)}@example.com`,
  ])('rejects unsupported email %s', (email) => {
    expect(() => validateEmail(email)).toThrow(BootstrapInputValidationError);
  });

  it('accepts field maximum lengths', () => {
    expect(validateFirstName('a'.repeat(100))).toHaveLength(100);
    expect(validateLastName('a'.repeat(100))).toHaveLength(100);
    expect(validateOperatorReference('o'.repeat(100))).toHaveLength(100);
    expect(validateAuthorizationReference('a'.repeat(200))).toHaveLength(200);
    expect(validateInstallationReference('i'.repeat(100))).toHaveLength(100);
  });
});
