import type { LoginAdmissionTime } from './login-admission.service.js';
import {
  PasswordRecoveryAdmissionService,
  type PasswordRecoveryAdmissionResult,
} from './password-recovery-admission.service.js';

class ControlledTime implements LoginAdmissionTime {
  private current = 0;

  now(): number {
    return this.current;
  }

  schedule(): () => void {
    return () => undefined;
  }

  advance(milliseconds: number): void {
    this.current += milliseconds;
  }
}

type ReadonlyIdentityState = {
  readonly identityBuckets: ReadonlyMap<unknown, unknown>;
};

function admitted(result: PasswordRecoveryAdmissionResult) {
  expect(result.status).toBe('ADMITTED');
  if (result.status !== 'ADMITTED') throw new Error('Expected admission');
  return result.reservation;
}

function testIp(index: number): string {
  return `2001:db8::${index.toString(16)}`;
}

describe('PasswordRecoveryAdmissionService', () => {
  it('A01 enforces three identity tokens and one refill every ten minutes', () => {
    const time = new ControlledTime();
    const service = new PasswordRecoveryAdmissionService(time);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      admitted(
        service.admitRequest('user@example.com', `192.0.2.${attempt + 1}`),
      ).commit();
    }

    expect(service.admitRequest('user@example.com', '192.0.2.10')).toEqual({
      status: 'RATE_LIMITED',
      flow: 'REQUEST',
      retryAfterSeconds: 600,
    });
    time.advance(599_000);
    expect(service.admitRequest('user@example.com', '192.0.2.10')).toEqual({
      status: 'RATE_LIMITED',
      flow: 'REQUEST',
      retryAfterSeconds: 1,
    });
    time.advance(1_000);
    admitted(service.admitRequest('user@example.com', '192.0.2.10')).commit();
  });

  it('A02 enforces thirty request tokens per IP and one refill per minute', () => {
    const time = new ControlledTime();
    const service = new PasswordRecoveryAdmissionService(time);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      admitted(
        service.admitRequest(`user${attempt}@example.com`, '192.0.2.1'),
      ).commit();
    }
    expect(service.admitRequest('next@example.com', '192.0.2.1')).toEqual({
      status: 'RATE_LIMITED',
      flow: 'REQUEST',
      retryAfterSeconds: 60,
    });
    time.advance(60_000);
    admitted(service.admitRequest('next@example.com', '192.0.2.1')).commit();
  });

  it('A03 enforces sixty reset tokens per IP and one refill every five seconds', () => {
    const time = new ControlledTime();
    const service = new PasswordRecoveryAdmissionService(time);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      admitted(service.admitReset('192.0.2.1')).commit();
    }
    expect(service.admitReset('192.0.2.1')).toEqual({
      status: 'RATE_LIMITED',
      flow: 'RESET',
      retryAfterSeconds: 5,
    });
    time.advance(5_000);
    admitted(service.admitReset('192.0.2.1')).commit();
  });

  it('A04 rejects a joint reservation without debiting the available IP', () => {
    const service = new PasswordRecoveryAdmissionService(new ControlledTime());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      admitted(
        service.admitRequest('limited@example.com', `192.0.2.${attempt + 1}`),
      ).commit();
    }
    expect(
      service.admitRequest('limited@example.com', '198.51.100.1').status,
    ).toBe('RATE_LIMITED');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      admitted(
        service.admitRequest(`available${attempt}@example.com`, '198.51.100.1'),
      ).commit();
    }
    expect(
      service.admitRequest('overflow@example.com', '198.51.100.1'),
    ).toMatchObject({ status: 'RATE_LIMITED', retryAfterSeconds: 60 });
  });

  it('A05 returns the greater applicable Retry-After without naming a bucket', () => {
    const service = new PasswordRecoveryAdmissionService(new ControlledTime());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      admitted(
        service.admitRequest('limited@example.com', `192.0.2.${attempt + 1}`),
      ).commit();
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      admitted(
        service.admitRequest(`ip${attempt}@example.com`, '198.51.100.1'),
      ).commit();
    }
    expect(service.admitRequest('limited@example.com', '198.51.100.1')).toEqual(
      {
        status: 'RATE_LIMITED',
        flow: 'REQUEST',
        retryAfterSeconds: 600,
      },
    );
  });

  it('A06 shares normalization and one opaque sentinel without retaining raw email', () => {
    const service = new PasswordRecoveryAdmissionService(new ControlledTime());
    for (const email of [
      ' USER@Example.COM ',
      'user@example.com',
      'User@EXAMPLE.com',
    ]) {
      admitted(service.admitRequest(email, '192.0.2.1')).commit();
    }
    expect(service.admitRequest('user@example.com', '192.0.2.2').status).toBe(
      'RATE_LIMITED',
    );

    const rawEmail = 'not-an-email-value';
    for (const email of [rawEmail, null, 'a@b']) {
      admitted(service.admitRequest(email, '192.0.2.3')).commit();
    }
    expect(service.admitRequest(undefined, '192.0.2.4').status).toBe(
      'RATE_LIMITED',
    );
    const state = service as unknown as ReadonlyIdentityState;
    const keys = [...state.identityBuckets.keys()];
    expect(keys.filter((key) => typeof key === 'symbol')).toHaveLength(1);
    expect(JSON.stringify(keys)).not.toContain(rawEmail);
  });

  it('A07 localizes identity saturation and preserves restrictive entries', () => {
    const service = new PasswordRecoveryAdmissionService(new ControlledTime());
    for (let index = 0; index < 16_000; index += 1) {
      admitted(
        service.admitRequest(
          `full${index}@example.com`,
          testIp(Math.floor(index / 4) + 1),
        ),
      ).commit();
    }
    expect(service.admitRequest('new@example.com', testIp(1))).toMatchObject({
      status: 'SERVICE_UNAVAILABLE',
      flow: 'REQUEST',
    });
    admitted(service.admitRequest('full0@example.com', testIp(1))).refund();
  });

  it('A08 localizes IP saturation without consuming a new identity', () => {
    const service = new PasswordRecoveryAdmissionService(new ControlledTime());
    for (let index = 1; index <= 4_000; index += 1) {
      admitted(service.admitReset(testIp(index))).commit();
    }
    expect(
      service.admitRequest('new@example.com', testIp(4_001)),
    ).toMatchObject({
      status: 'SERVICE_UNAVAILABLE',
      flow: 'REQUEST',
    });
    for (let index = 1; index <= 3; index += 1) {
      admitted(service.admitRequest('new@example.com', testIp(index))).commit();
    }
    expect(service.admitRequest('new@example.com', testIp(4))).toMatchObject({
      status: 'RATE_LIMITED',
      retryAfterSeconds: 600,
    });
  });

  it('A09 preserves a fully refilled identity while its real reservation remains open', () => {
    const time = new ControlledTime();
    const service = new PasswordRecoveryAdmissionService(time);
    const open = admitted(service.admitRequest('open@example.com', testIp(1)));
    time.advance(600_000);
    for (let index = 1; index < 16_000; index += 1) {
      admitted(
        service.admitRequest(
          `restrictive${index}@example.com`,
          testIp(Math.floor(index / 4) + 1),
        ),
      ).commit();
    }
    expect(
      service.admitRequest('replacement@example.com', testIp(1)),
    ).toMatchObject({ status: 'SERVICE_UNAVAILABLE', flow: 'REQUEST' });

    open.refund();
    admitted(
      service.admitRequest('replacement@example.com', testIp(1)),
    ).commit();
    expect(
      service.admitRequest('second-replacement@example.com', testIp(1)),
    ).toMatchObject({ status: 'SERVICE_UNAVAILABLE', flow: 'REQUEST' });
  });

  it('A09 removes a composite IP only after request and reset buckets both recover', () => {
    const time = new ControlledTime();
    const service = new PasswordRecoveryAdmissionService(time);
    admitted(service.admitRequest('target@example.com', testIp(1))).commit();
    for (let attempt = 0; attempt < 13; attempt += 1) {
      admitted(service.admitReset(testIp(1))).commit();
    }

    time.advance(60_000);
    for (let index = 2; index <= 4_000; index += 1) {
      admitted(service.admitReset(testIp(index))).commit();
      admitted(service.admitReset(testIp(index))).commit();
    }
    expect(service.admitReset(testIp(4_001))).toMatchObject({
      status: 'SERVICE_UNAVAILABLE',
      flow: 'RESET',
    });

    time.advance(5_000);
    admitted(service.admitReset(testIp(4_001))).commit();
    expect(service.admitReset(testIp(4_002))).toMatchObject({
      status: 'SERVICE_UNAVAILABLE',
      flow: 'RESET',
    });
  });

  it('A10 refunds once without exceeding capacity and keeps commit final', () => {
    const service = new PasswordRecoveryAdmissionService(new ControlledTime());
    const reservation = admitted(
      service.admitRequest('user@example.com', '192.0.2.1'),
    );
    reservation.refund();
    reservation.refund();
    reservation.commit();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      admitted(
        service.admitRequest('user@example.com', `192.0.2.${attempt + 2}`),
      ).commit();
    }
    expect(service.admitRequest('user@example.com', '192.0.2.10').status).toBe(
      'RATE_LIMITED',
    );
  });

  it('A11 serializes synchronous reservations without duplicate debit', () => {
    const service = new PasswordRecoveryAdmissionService(new ControlledTime());
    const results = [1, 2, 3, 4].map((suffix) =>
      service.admitRequest('same@example.com', `192.0.2.${suffix}`),
    );
    expect(results.map(({ status }) => status)).toEqual([
      'ADMITTED',
      'ADMITTED',
      'ADMITTED',
      'RATE_LIMITED',
    ]);
    for (const result of results) {
      if (result.status === 'ADMITTED') result.reservation.commit();
    }
  });

  it('A12 exposes pre-admission rejection so no later processing is invoked', () => {
    const service = new PasswordRecoveryAdmissionService(new ControlledTime());
    const processing = vi.fn();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      admitted(service.admitReset('192.0.2.1')).commit();
    }
    const result = service.admitReset('192.0.2.1');
    if (result.status === 'ADMITTED') processing();
    expect(result.status).toBe('RATE_LIMITED');
    expect(processing).not.toHaveBeenCalled();
  });
});
