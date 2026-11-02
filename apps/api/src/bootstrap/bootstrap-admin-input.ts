const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export class BootstrapInputValidationError extends Error {
  constructor(field: string) {
    super(`Invalid bootstrap field: ${field}`);
    this.name = 'BootstrapInputValidationError';
  }
}

function trimAsciiSpaces(value: string): string {
  return value.replace(/^ +| +$/g, '');
}

function codePointLength(value: string): number {
  let length = 0;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new BootstrapInputValidationError('Unicode');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new BootstrapInputValidationError('Unicode');
    }
    length += 1;
  }

  return length;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function validateText(
  field: string,
  value: string,
  maximumLength: number,
): string {
  const normalized = trimAsciiSpaces(value);
  const length = codePointLength(normalized);
  if (
    length < 1 ||
    length > maximumLength ||
    containsControlCharacter(normalized)
  ) {
    throw new BootstrapInputValidationError(field);
  }
  return normalized;
}

export function validateFirstName(value: string): string {
  return validateText('firstName', value, 100);
}

export function validateLastName(value: string): string {
  return validateText('lastName', value, 100);
}

export function validateEmail(value: string): string {
  const email = trimAsciiSpaces(value);
  const localPart = email.split('@', 1)[0];
  if (
    email.length < 3 ||
    email.length > 254 ||
    localPart.length < 1 ||
    localPart.length > 64 ||
    !EMAIL_PATTERN.test(email)
  ) {
    throw new BootstrapInputValidationError('email');
  }
  return email;
}

export function validateOperatorReference(value: string): string {
  return validateText('operatorReference', value, 100);
}

export function validateAuthorizationReference(value: string): string {
  return validateText('authorizationReference', value, 200);
}

export function validateInstallationReference(value: string): string {
  return validateText('installationReference', value, 100);
}
