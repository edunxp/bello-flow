import { PasswordCredentialService } from './password-credential.service.js';

const POSTGRESQL_PHC_PATTERN =
  /^\$argon2id\$v=19\$m=[1-9][0-9]*,t=[1-9][0-9]*,p=[1-9][0-9]*\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/;

describe('PasswordCredentialService cryptography', () => {
  const service = new PasswordCredentialService();
  const password = 'correct horse 🐎';
  let encodedHash: string;

  beforeAll(async () => {
    encodedHash = await service.hashPassword(password);
  });

  it('exposes the password policy validation', () => {
    expect(() => service.validatePassword('a'.repeat(12))).not.toThrow();
    expect(() => service.validatePassword('a'.repeat(11))).toThrow();
  });

  it('hashes and verifies the correct password', async () => {
    await expect(service.verifyPassword(password, encodedHash)).resolves.toBe(
      true,
    );
  });

  it('rejects an incorrect password', async () => {
    await expect(
      service.verifyPassword('incorrect horse 🐎', encodedHash),
    ).resolves.toBe(false);
  });

  it('uses a fresh random salt for every hash', async () => {
    const secondHash = await service.hashPassword(password);

    expect(secondHash).not.toBe(encodedHash);
    await expect(service.verifyPassword(password, secondHash)).resolves.toBe(
      true,
    );
  });

  it('produces the approved Argon2id PHC profile', () => {
    const parts = encodedHash.split('$');

    expect(parts).toHaveLength(6);
    expect(parts[1]).toBe('argon2id');
    expect(parts[2]).toBe('v=19');
    expect(parts[3]).toBe('m=65536,t=3,p=1');
    expect(Buffer.from(parts[4]!, 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[5]!, 'base64')).toHaveLength(32);
  });

  it('produces PHC accepted by the documented PostgreSQL constraint', () => {
    expect(encodedHash).toMatch(POSTGRESQL_PHC_PATTERN);
  });

  it('does not normalize or trim passwords', async () => {
    const significantPassword = '  Cafe\u0301 secret  ';
    const significantHash = await service.hashPassword(significantPassword);

    await expect(
      service.verifyPassword(significantPassword, significantHash),
    ).resolves.toBe(true);
    await expect(
      service.verifyPassword(significantPassword.trim(), significantHash),
    ).resolves.toBe(false);
    await expect(
      service.verifyPassword('  Café secret  ', significantHash),
    ).resolves.toBe(false);
  });

  it.each([
    ['malformed PHC', 'not-a-phc'],
    [
      'unapproved parameters',
      '$argon2id$v=19$m=8,t=1,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY',
    ],
    ['non-string PHC', null],
  ])('fails closed for %s', async (_description, hash) => {
    await expect(service.verifyPassword(password, hash)).resolves.toBe(false);
  });

  it('fails closed without logging sensitive verification inputs', async () => {
    const sensitivePassword = 'sensitive password';
    const sensitiveHash = '$argon2id$sensitive-hash';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.verifyPassword(sensitivePassword, sensitiveHash),
    ).resolves.toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('fails closed when the candidate password is malformed Unicode', async () => {
    await expect(
      service.verifyPassword(`valid-prefix-${'\ud800'}`, encodedHash),
    ).resolves.toBe(false);
  });
});
