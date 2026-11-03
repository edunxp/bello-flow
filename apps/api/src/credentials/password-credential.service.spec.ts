const argon2Mock = vi.hoisted(() => ({ verify: vi.fn() }));

vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  argon2Mock.verify.mockImplementation(actual.verify);
  return { ...actual, verify: argon2Mock.verify };
});

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

  beforeEach(() => {
    argon2Mock.verify.mockClear();
  });

  it('exposes the password policy validation', () => {
    expect(() => service.validatePassword('a'.repeat(12))).not.toThrow();
    expect(() => service.validatePassword('a'.repeat(11))).toThrow();
  });

  it('distinguishes a matching password from a mismatch', async () => {
    await expect(
      service.verifyPassword(password, encodedHash),
    ).resolves.toEqual({ status: 'MATCH' });
    await expect(
      service.verifyPassword('incorrect horse 🐎', encodedHash),
    ).resolves.toEqual({ status: 'NO_MATCH' });
  });

  it('uses a fresh random salt for every hash', async () => {
    const secondHash = await service.hashPassword(password);

    expect(secondHash).not.toBe(encodedHash);
    await expect(service.verifyPassword(password, secondHash)).resolves.toEqual(
      { status: 'MATCH' },
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
    ).resolves.toEqual({ status: 'MATCH' });
    await expect(
      service.verifyPassword(significantPassword.trim(), significantHash),
    ).resolves.toEqual({ status: 'NO_MATCH' });
    await expect(
      service.verifyPassword('  Café secret  ', significantHash),
    ).resolves.toEqual({ status: 'NO_MATCH' });
  });

  it.each([
    ['malformed PHC', 'not-a-phc'],
    [
      'unapproved parameters',
      '$argon2id$v=19$m=8,t=1,p=1$c2FsdHNhbHRzYWx0MTIzNA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY',
    ],
    ['non-string PHC', null],
  ])('classifies %s as an invalid stored hash', async (_description, hash) => {
    await expect(service.verifyPassword(password, hash)).resolves.toEqual({
      status: 'INVALID_STORED_HASH',
    });
    expect(argon2Mock.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['short password', 'short'],
    ['malformed Unicode', `valid-prefix-${'\ud800'}`],
    ['non-string candidate', null],
  ])(
    'classifies %s without invoking Argon2',
    async (_description, candidate) => {
      await expect(
        service.verifyPassword(candidate, encodedHash),
      ).resolves.toEqual({ status: 'INVALID_CANDIDATE' });
      expect(argon2Mock.verify).not.toHaveBeenCalled();
    },
  );

  it('keeps an Argon2 exception distinct from a password mismatch', async () => {
    argon2Mock.verify.mockRejectedValueOnce(new Error('native failure'));

    const result = await service.verifyPassword(password, encodedHash);

    expect(result).toEqual({ status: 'OPERATIONAL_FAILURE' });
    expect(JSON.stringify(result)).not.toContain(password);
    expect(JSON.stringify(result)).not.toContain(encodedHash);
  });

  it('performs negative Argon2 work with a valid approved synthetic PHC', async () => {
    const result = await service.performNegativeVerification(password);

    expect(result).toEqual({
      status: 'COMPLETED',
      candidateStatus: 'VALID',
    });
    expect(argon2Mock.verify).toHaveBeenCalledOnce();
    const [syntheticHash] = argon2Mock.verify.mock.calls[0]!;
    const parts = (syntheticHash as string).split('$');
    expect(parts[1]).toBe('argon2id');
    expect(parts[2]).toBe('v=19');
    expect(parts[3]).toBe('m=65536,t=3,p=1');
    expect(Buffer.from(parts[4]!, 'base64')).toHaveLength(16);
    expect(Buffer.from(parts[5]!, 'base64')).toHaveLength(32);
  });

  it('uses a valid substitute for negative work with an invalid candidate', async () => {
    const result = await service.performNegativeVerification('short');

    expect(result).toEqual({
      status: 'COMPLETED',
      candidateStatus: 'INVALID',
    });
    expect(argon2Mock.verify).toHaveBeenCalledOnce();
    expect(argon2Mock.verify.mock.calls[0]![1]).toBe(
      'bello-negative-verification-work',
    );
  });

  it('never exposes a synthetic match as authentication', async () => {
    argon2Mock.verify.mockResolvedValueOnce(true);

    await expect(
      service.performNegativeVerification(password),
    ).resolves.toEqual({
      status: 'COMPLETED',
      candidateStatus: 'VALID',
    });
  });

  it('preserves operational failures from negative verification', async () => {
    argon2Mock.verify.mockRejectedValueOnce(new Error('native failure'));

    await expect(
      service.performNegativeVerification(password),
    ).resolves.toEqual({ status: 'OPERATIONAL_FAILURE' });
  });

  it('preserves operational failures from invalid-candidate substitute work', async () => {
    argon2Mock.verify.mockRejectedValueOnce(new Error('native failure'));

    await expect(service.performNegativeVerification('short')).resolves.toEqual(
      { status: 'OPERATIONAL_FAILURE' },
    );
  });

  it('does not log sensitive verification inputs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await service.verifyPassword(password, encodedHash);
    await service.performNegativeVerification(password);

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
