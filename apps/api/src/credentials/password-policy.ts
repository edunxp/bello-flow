export const MIN_PASSWORD_CODE_POINTS = 12;
export const MAX_PASSWORD_CODE_POINTS = 128;

const PASSWORD_POLICY_MESSAGE =
  'Password must be well-formed Unicode with 12 to 128 code points';

export class PasswordPolicyError extends Error {
  constructor() {
    super(PASSWORD_POLICY_MESSAGE);
    this.name = 'PasswordPolicyError';
  }
}

function countWellFormedCodePoints(value: string): number {
  let count = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (
        index + 1 >= value.length ||
        nextCodeUnit < 0xdc00 ||
        nextCodeUnit > 0xdfff
      ) {
        throw new PasswordPolicyError();
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new PasswordPolicyError();
    }

    count += 1;
  }

  return count;
}

export function assertValidPassword(
  password: unknown,
): asserts password is string {
  if (typeof password !== 'string') {
    throw new PasswordPolicyError();
  }

  const codePoints = countWellFormedCodePoints(password);
  if (
    codePoints < MIN_PASSWORD_CODE_POINTS ||
    codePoints > MAX_PASSWORD_CODE_POINTS
  ) {
    throw new PasswordPolicyError();
  }
}
