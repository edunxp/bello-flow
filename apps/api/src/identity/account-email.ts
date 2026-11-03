declare const emailKeyBrand: unique symbol;

export type EmailKey = string & { readonly [emailKeyBrand]: true };

export type AccountEmailNormalizationResult =
  | {
      readonly status: 'VALID';
      readonly email: string;
      readonly emailKey: EmailKey;
    }
  | { readonly status: 'INVALID' };

const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function trimAsciiSpaces(value: string): string {
  return value.replace(/^ +| +$/g, '');
}

function toAsciiLowerCase(value: string): EmailKey {
  return value.replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32),
  ) as EmailKey;
}

export function normalizeAccountEmail(
  value: unknown,
): AccountEmailNormalizationResult {
  if (typeof value !== 'string') {
    return { status: 'INVALID' };
  }

  const email = trimAsciiSpaces(value);
  const localPart = email.split('@', 1)[0]!;
  if (
    email.length < 3 ||
    email.length > 254 ||
    localPart.length < 1 ||
    localPart.length > 64 ||
    !EMAIL_PATTERN.test(email)
  ) {
    return { status: 'INVALID' };
  }

  return {
    status: 'VALID',
    email,
    emailKey: toAsciiLowerCase(email),
  };
}
