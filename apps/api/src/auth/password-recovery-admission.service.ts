import { Inject, Injectable } from '@nestjs/common';
import {
  normalizeAccountEmail,
  type EmailKey,
} from '../identity/account-email.js';
import { canonicalizeTrustedIp } from './login-admission.service.js';
import { ADMISSION_TIME, type AdmissionTime } from './admission-time.js';

const REQUEST_IDENTITY_CAPACITY = 3;
const REQUEST_IDENTITY_REFILL_MS = 600_000;
const REQUEST_IP_CAPACITY = 30;
const REQUEST_IP_REFILL_MS = 60_000;
const RESET_IP_CAPACITY = 60;
const RESET_IP_REFILL_MS = 5_000;
const IDENTITY_BUCKETS_MAX = 16_000;
const IP_BUCKETS_MAX = 4_000;
const INCREMENTAL_CLEANUP_LIMIT = 32;
const INVALID_EMAIL_SENTINEL: unique symbol = Symbol(
  'PASSWORD_RECOVERY_INVALID_EMAIL_SENTINEL',
);

type IdentityKey = EmailKey | typeof INVALID_EMAIL_SENTINEL;

type Bucket = {
  tokens: number;
  lastRefillMs: number;
  readonly reservations: Set<symbol>;
};

type IpBuckets = {
  request?: Bucket;
  reset?: Bucket;
};

type ReservedBucket = {
  readonly bucket: Bucket;
  readonly capacity: number;
};

export type PasswordRecoveryAdmissionFlow = 'REQUEST' | 'RESET';

export interface PasswordRecoveryAdmissionReservation {
  readonly flow: PasswordRecoveryAdmissionFlow;
  commit(): void;
  refund(): void;
}

export type PasswordRecoveryAdmissionResult =
  | {
      readonly status: 'ADMITTED';
      readonly flow: PasswordRecoveryAdmissionFlow;
      readonly reservation: PasswordRecoveryAdmissionReservation;
    }
  | {
      readonly status: 'RATE_LIMITED';
      readonly flow: PasswordRecoveryAdmissionFlow;
      readonly retryAfterSeconds: number;
    }
  | {
      readonly status: 'SERVICE_UNAVAILABLE';
      readonly flow: PasswordRecoveryAdmissionFlow;
    };

class Reservation implements PasswordRecoveryAdmissionReservation {
  private state: 'OPEN' | 'COMMITTED' | 'REFUNDED' = 'OPEN';

  constructor(
    readonly flow: PasswordRecoveryAdmissionFlow,
    private readonly id: symbol,
    private readonly buckets: readonly ReservedBucket[],
  ) {}

  commit(): void {
    if (this.state !== 'OPEN') return;
    this.state = 'COMMITTED';
    for (const { bucket } of this.buckets) {
      bucket.reservations.delete(this.id);
    }
  }

  refund(): void {
    if (this.state !== 'OPEN') return;
    this.state = 'REFUNDED';
    for (const { bucket, capacity } of this.buckets) {
      if (bucket.reservations.delete(this.id)) {
        bucket.tokens = Math.min(capacity, bucket.tokens + 1);
      }
    }
  }
}

@Injectable()
export class PasswordRecoveryAdmissionService {
  private readonly identityBuckets = new Map<IdentityKey, Bucket>();
  private readonly ipBuckets = new Map<string, IpBuckets>();
  private identityCleanupIterator?: MapIterator<[IdentityKey, Bucket]>;
  private ipCleanupIterator?: MapIterator<[string, IpBuckets]>;

  constructor(
    @Inject(ADMISSION_TIME)
    private readonly time: AdmissionTime,
  ) {}

  admitRequest(
    email: unknown,
    trustedIp: unknown,
  ): PasswordRecoveryAdmissionResult {
    const flow = 'REQUEST' as const;
    const ipKey = canonicalizeTrustedIp(trustedIp);
    if (ipKey === null) return { status: 'SERVICE_UNAVAILABLE', flow };

    const normalized = normalizeAccountEmail(email);
    const identityKey =
      normalized.status === 'VALID'
        ? normalized.emailKey
        : INVALID_EMAIL_SENTINEL;
    const now = this.time.now();
    this.cleanupIncrementally(now);

    const existingIdentity = this.identityBuckets.get(identityKey);
    const existingIpEntry = this.ipBuckets.get(ipKey);
    if (
      (!existingIdentity && !this.ensureIdentitySlot(identityKey, now)) ||
      (!existingIpEntry && !this.ensureIpSlot(ipKey, now))
    ) {
      return { status: 'SERVICE_UNAVAILABLE', flow };
    }

    const identity =
      existingIdentity ?? this.newBucket(REQUEST_IDENTITY_CAPACITY, now);
    const ip =
      existingIpEntry?.request ?? this.newBucket(REQUEST_IP_CAPACITY, now);
    this.refill(
      identity,
      REQUEST_IDENTITY_CAPACITY,
      REQUEST_IDENTITY_REFILL_MS,
      now,
    );
    this.refill(ip, REQUEST_IP_CAPACITY, REQUEST_IP_REFILL_MS, now);

    if (identity.tokens === 0 || ip.tokens === 0) {
      return {
        status: 'RATE_LIMITED',
        flow,
        retryAfterSeconds: Math.max(
          identity.tokens === 0
            ? this.retryAfter(identity, REQUEST_IDENTITY_REFILL_MS, now)
            : 0,
          ip.tokens === 0 ? this.retryAfter(ip, REQUEST_IP_REFILL_MS, now) : 0,
        ),
      };
    }

    if (!existingIdentity) this.identityBuckets.set(identityKey, identity);
    const ipEntry = existingIpEntry ?? {};
    if (!existingIpEntry) this.ipBuckets.set(ipKey, ipEntry);
    if (!ipEntry.request) ipEntry.request = ip;
    return this.reserve(flow, [
      { bucket: identity, capacity: REQUEST_IDENTITY_CAPACITY },
      { bucket: ip, capacity: REQUEST_IP_CAPACITY },
    ]);
  }

  admitReset(trustedIp: unknown): PasswordRecoveryAdmissionResult {
    const flow = 'RESET' as const;
    const ipKey = canonicalizeTrustedIp(trustedIp);
    if (ipKey === null) return { status: 'SERVICE_UNAVAILABLE', flow };

    const now = this.time.now();
    this.cleanupIncrementally(now);
    const existingIpEntry = this.ipBuckets.get(ipKey);
    if (!existingIpEntry && !this.ensureIpSlot(ipKey, now)) {
      return { status: 'SERVICE_UNAVAILABLE', flow };
    }

    const ip = existingIpEntry?.reset ?? this.newBucket(RESET_IP_CAPACITY, now);
    this.refill(ip, RESET_IP_CAPACITY, RESET_IP_REFILL_MS, now);
    if (ip.tokens === 0) {
      return {
        status: 'RATE_LIMITED',
        flow,
        retryAfterSeconds: this.retryAfter(ip, RESET_IP_REFILL_MS, now),
      };
    }

    const ipEntry = existingIpEntry ?? {};
    if (!existingIpEntry) this.ipBuckets.set(ipKey, ipEntry);
    if (!ipEntry.reset) ipEntry.reset = ip;
    return this.reserve(flow, [{ bucket: ip, capacity: RESET_IP_CAPACITY }]);
  }

  private reserve(
    flow: PasswordRecoveryAdmissionFlow,
    buckets: readonly ReservedBucket[],
  ): PasswordRecoveryAdmissionResult {
    const id = Symbol('PASSWORD_RECOVERY_ADMISSION_RESERVATION');
    for (const { bucket } of buckets) {
      bucket.tokens -= 1;
      bucket.reservations.add(id);
    }
    const reservation = new Reservation(flow, id, buckets);
    return { status: 'ADMITTED', flow, reservation };
  }

  private newBucket(capacity: number, now: number): Bucket {
    return { tokens: capacity, lastRefillMs: now, reservations: new Set() };
  }

  private refill(
    bucket: Bucket,
    capacity: number,
    intervalMs: number,
    now: number,
  ): void {
    if (now <= bucket.lastRefillMs) return;
    if (bucket.tokens >= capacity) {
      bucket.lastRefillMs = now;
      return;
    }
    const intervals = Math.floor((now - bucket.lastRefillMs) / intervalMs);
    if (intervals === 0) return;
    if (bucket.tokens + intervals >= capacity) {
      bucket.tokens = capacity;
      bucket.lastRefillMs = now;
    } else {
      bucket.tokens += intervals;
      bucket.lastRefillMs += intervals * intervalMs;
    }
  }

  private retryAfter(bucket: Bucket, intervalMs: number, now: number): number {
    return Math.max(
      1,
      Math.ceil((bucket.lastRefillMs + intervalMs - now) / 1_000),
    );
  }

  private ensureIdentitySlot(key: IdentityKey, now: number): boolean {
    if (
      this.identityBuckets.has(key) ||
      this.identityBuckets.size < IDENTITY_BUCKETS_MAX
    ) {
      return true;
    }
    for (const [candidate, bucket] of this.identityBuckets) {
      this.refill(
        bucket,
        REQUEST_IDENTITY_CAPACITY,
        REQUEST_IDENTITY_REFILL_MS,
        now,
      );
      if (this.isRemovable(bucket, REQUEST_IDENTITY_CAPACITY)) {
        this.identityBuckets.delete(candidate);
      }
    }
    this.identityCleanupIterator = undefined;
    return this.identityBuckets.size < IDENTITY_BUCKETS_MAX;
  }

  private ensureIpSlot(key: string, now: number): boolean {
    if (this.ipBuckets.has(key) || this.ipBuckets.size < IP_BUCKETS_MAX) {
      return true;
    }
    for (const [candidate, buckets] of this.ipBuckets) {
      this.refillIpBuckets(buckets, now);
      if (this.isIpRemovable(buckets)) this.ipBuckets.delete(candidate);
    }
    this.ipCleanupIterator = undefined;
    return this.ipBuckets.size < IP_BUCKETS_MAX;
  }

  private cleanupIncrementally(now: number): void {
    const identityIterator =
      this.identityCleanupIterator ?? this.identityBuckets.entries();
    this.identityCleanupIterator = this.cleanupSome(
      identityIterator,
      INCREMENTAL_CLEANUP_LIMIT,
      ([key, bucket]) => {
        this.refill(
          bucket,
          REQUEST_IDENTITY_CAPACITY,
          REQUEST_IDENTITY_REFILL_MS,
          now,
        );
        if (this.isRemovable(bucket, REQUEST_IDENTITY_CAPACITY)) {
          this.identityBuckets.delete(key);
        }
      },
    );

    const ipIterator = this.ipCleanupIterator ?? this.ipBuckets.entries();
    this.ipCleanupIterator = this.cleanupSome(
      ipIterator,
      INCREMENTAL_CLEANUP_LIMIT,
      ([key, buckets]) => {
        this.refillIpBuckets(buckets, now);
        if (this.isIpRemovable(buckets)) this.ipBuckets.delete(key);
      },
    );
  }

  private cleanupSome<T>(
    iterator: MapIterator<T>,
    limit: number,
    inspect: (value: T) => void,
  ): MapIterator<T> | undefined {
    for (let inspected = 0; inspected < limit; inspected += 1) {
      const entry = iterator.next();
      if (entry.done) return undefined;
      inspect(entry.value);
    }
    return iterator;
  }

  private refillIpBuckets(buckets: IpBuckets, now: number): void {
    if (buckets.request) {
      this.refill(
        buckets.request,
        REQUEST_IP_CAPACITY,
        REQUEST_IP_REFILL_MS,
        now,
      );
    }
    if (buckets.reset) {
      this.refill(buckets.reset, RESET_IP_CAPACITY, RESET_IP_REFILL_MS, now);
    }
  }

  private isIpRemovable(buckets: IpBuckets): boolean {
    return (
      (!buckets.request ||
        this.isRemovable(buckets.request, REQUEST_IP_CAPACITY)) &&
      (!buckets.reset || this.isRemovable(buckets.reset, RESET_IP_CAPACITY))
    );
  }

  private isRemovable(bucket: Bucket, capacity: number): boolean {
    return bucket.tokens === capacity && bucket.reservations.size === 0;
  }
}
