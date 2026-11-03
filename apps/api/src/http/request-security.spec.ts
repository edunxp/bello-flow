import {
  REQUEST_SECURITY_FAILURE,
  validateApplicationRequestHeader,
  validateJsonContentType,
  validateMutatingRequestOrigin,
} from './request-security.js';

const origin = 'https://bello.example';

describe('request security policies', () => {
  it('accepts only one exact application request header', () => {
    expect(
      validateApplicationRequestHeader(['x-bello-flow-request', '1']),
    ).toEqual({ valid: true });
    expect(validateApplicationRequestHeader([])).toEqual({
      valid: false,
      reason: REQUEST_SECURITY_FAILURE.MISSING,
    });
    expect(
      validateApplicationRequestHeader([
        'X-Bello-Flow-Request',
        '1',
        'x-bello-flow-request',
        '1',
      ]),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.DUPLICATE });
    expect(
      validateApplicationRequestHeader(['X-Bello-Flow-Request', '1, 1']),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.DUPLICATE });
    expect(
      validateApplicationRequestHeader(['X-Bello-Flow-Request', ' 1']),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
    expect(validateApplicationRequestHeader(['orphan'])).toEqual({
      valid: false,
      reason: REQUEST_SECURITY_FAILURE.INVALID,
    });
  });

  it('accepts only the exact unique canonical Origin when present', () => {
    expect(validateMutatingRequestOrigin(['Origin', origin], origin)).toEqual({
      valid: true,
    });
    expect(
      validateMutatingRequestOrigin(
        ['Origin', origin, 'origin', origin],
        origin,
      ),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.DUPLICATE });
    expect(validateMutatingRequestOrigin(['Origin', 'null'], origin)).toEqual({
      valid: false,
      reason: REQUEST_SECURITY_FAILURE.INVALID,
    });
    expect(
      validateMutatingRequestOrigin(['Origin', `${origin}/`], origin),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
    expect(
      validateMutatingRequestOrigin(
        ['Origin', 'https://other.example'],
        origin,
      ),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.MISMATCH });
    expect(
      validateMutatingRequestOrigin(
        ['Origin', 'not a URL', 'Referer', `${origin}/fallback`],
        origin,
      ),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
  });

  it('uses Referer only as a valid same-origin fallback', () => {
    expect(
      validateMutatingRequestOrigin(
        ['Referer', `${origin}/login?from=web`],
        origin,
      ),
    ).toEqual({ valid: true });
    expect(
      validateMutatingRequestOrigin(
        ['Referer', `${origin}.attacker.example/login`],
        origin,
      ),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.MISMATCH });
    expect(
      validateMutatingRequestOrigin(['Referer', 'not a URL'], origin),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
    expect(validateMutatingRequestOrigin([], origin)).toEqual({
      valid: false,
      reason: REQUEST_SECURITY_FAILURE.MISSING,
    });
    expect(
      validateMutatingRequestOrigin(
        ['Referer', `${origin}/one`, 'referer', `${origin}/two`],
        origin,
      ),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.DUPLICATE });
  });

  it('rejects ambiguous or syntactically invalid Referer values', () => {
    for (const referer of [
      `${origin}/one, ${origin}/two`,
      `${origin}/path,https://attacker.example/`,
      `${origin}/path with-space`,
      `${origin}/path\twith-tab`,
      `${origin}/path\\with-backslash`,
      `${origin}/path\u007fwith-control`,
      '//bello.example/relative',
      'mailto:user@bello.example',
      'https://user:password@bello.example/',
    ]) {
      expect(
        validateMutatingRequestOrigin(['Referer', referer], origin),
      ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
    }
  });

  it('accepts application/json and valid parameters only', () => {
    expect(
      validateJsonContentType(['Content-Type', 'application/json']),
    ).toEqual({
      valid: true,
    });
    expect(
      validateJsonContentType([
        'content-type',
        'Application/JSON; charset=utf-8; profile="bello \\"profile\\""',
      ]),
    ).toEqual({ valid: true });
    expect(validateJsonContentType([])).toEqual({
      valid: false,
      reason: REQUEST_SECURITY_FAILURE.MISSING,
    });
    expect(
      validateJsonContentType([
        'Content-Type',
        'application/json',
        'content-type',
        'application/json',
      ]),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.DUPLICATE });
    expect(
      validateJsonContentType(['Content-Type', 'application/json, text/plain']),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
    expect(
      validateJsonContentType(['Content-Type', 'application/problem+json']),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
    expect(
      validateJsonContentType(['Content-Type', 'application/json; charset']),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
    expect(
      validateJsonContentType([
        'Content-Type',
        'application/json; profile="unterminated',
      ]),
    ).toEqual({ valid: false, reason: REQUEST_SECURITY_FAILURE.INVALID });
  });
});
