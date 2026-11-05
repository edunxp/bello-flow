import { isIP, SocketAddress } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import {
  normalizeAccountEmail,
  type EmailKey,
} from '../identity/account-email.js';
import {
  LOGIN_ADMISSION_CONFIG,
  type LoginAdmissionConfig,
} from './login-admission.config.js';
import {
  Argon2ExecutionError,
  Argon2ExecutionService,
} from './argon2-execution.service.js';
import {
  ADMISSION_TIME,
  SYSTEM_ADMISSION_TIME,
  type AdmissionTime,
} from './admission-time.js';

const IDENTITY_CAPACITY = 5;
const IDENTITY_REFILL_MS = 180_000;
const IP_CAPACITY = 60;
const IP_REFILL_MS = 5_000;
const INCREMENTAL_CLEANUP_LIMIT = 32;
const INVALID_EMAIL_SENTINEL: unique symbol = Symbol('INVALID_EMAIL_SENTINEL');

declare const trustedIpKeyBrand: unique symbol;
type TrustedIpKey = string & { readonly [trustedIpKeyBrand]: true };
type IdentityKey = EmailKey | typeof INVALID_EMAIL_SENTINEL;
type BucketKey = IdentityKey | TrustedIpKey;

export const LOGIN_ADMISSION_TIME = ADMISSION_TIME;
export const SYSTEM_LOGIN_ADMISSION_TIME = SYSTEM_ADMISSION_TIME;
export type LoginAdmissionTime = AdmissionTime;

export const LOGIN_ADMISSION_ERROR_CODE = Object.freeze({
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const);

export type LoginAdmissionErrorCode =
  (typeof LOGIN_ADMISSION_ERROR_CODE)[keyof typeof LOGIN_ADMISSION_ERROR_CODE];

export class LoginAdmissionError extends Error {
  constructor(
    public readonly code: LoginAdmissionErrorCode,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'LoginAdmissionError';
  }
}

export type LoginAdmissionCompletion<T> =
  | { readonly status: 'AUTHENTICATED'; readonly value: T }
  | { readonly status: 'DETERMINED_REJECTION'; readonly error: Error }
  | { readonly status: 'OPERATIONAL_FAILURE'; readonly error: Error }
  | { readonly status: 'INDETERMINATE'; readonly error: Error };

export interface LoginAdmissionExecution<T> {
  readonly email: unknown;
  readonly trustedIp: unknown;
  readonly signal?: AbortSignal;
  readonly operation: () => Promise<LoginAdmissionCompletion<T>>;
}

type Bucket = {
  tokens: number;
  lastRefillMs: number;
  generation: number;
  readonly reservations: Map<symbol, number>;
};

type BucketReservation = {
  readonly bucket: Bucket;
  readonly generation: number;
};

type Reservation = {
  state: 'OPEN' | 'COMMITTED' | 'REFUNDED';
  readonly id: symbol;
  readonly identityKey: IdentityKey;
  readonly identity: BucketReservation;
  readonly ip: BucketReservation;
};

function serviceUnavailable(): LoginAdmissionError {
  return new LoginAdmissionError(
    LOGIN_ADMISSION_ERROR_CODE.SERVICE_UNAVAILABLE,
  );
}

export function canonicalizeTrustedIp(value: unknown): TrustedIpKey | null {
  if (typeof value !== 'string' || value.length === 0 || value.includes('%')) {
    return null;
  }

  const version = isIP(value);
  if (version === 0) {
    return null;
  }

  let address: string;
  try {
    address = new SocketAddress({
      address: value,
      family: version === 4 ? 'ipv4' : 'ipv6',
      port: 0,
    }).address;
  } catch {
    return null;
  }

  if (version === 6 && address.startsWith('::ffff:')) {
    const mappedIpv4 = address.slice('::ffff:'.length);
    if (isIP(mappedIpv4) === 4) {
      return `ipv4:${mappedIpv4}` as TrustedIpKey;
    }
  }

  return `${version === 4 ? 'ipv4' : 'ipv6'}:${address}` as TrustedIpKey;
}

@Injectable()
export class LoginAdmissionService {
  private readonly identityBuckets = new Map<IdentityKey, Bucket>();
  private readonly ipBuckets = new Map<TrustedIpKey, Bucket>();
  private identityCleanupIterator?: MapIterator<[IdentityKey, Bucket]>;
  private ipCleanupIterator?: MapIterator<[TrustedIpKey, Bucket]>;

  constructor(
    @Inject(LOGIN_ADMISSION_CONFIG)
    private readonly config: LoginAdmissionConfig,
    @Inject(LOGIN_ADMISSION_TIME)
    private readonly time: LoginAdmissionTime,
    private readonly argon2Execution: Argon2ExecutionService,
  ) {}

  async executeProtected<T>(execution: LoginAdmissionExecution<T>): Promise<T> {
    const ipKey = canonicalizeTrustedIp(execution.trustedIp);
    if (ipKey === null) {
      throw serviceUnavailable();
    }

    const normalizedEmail = normalizeAccountEmail(execution.email);
    const identityKey =
      normalizedEmail.status === 'VALID'
        ? normalizedEmail.emailKey
        : INVALID_EMAIL_SENTINEL;
    const reservation = this.reserve(identityKey, ipKey);

    try {
      return await this.argon2Execution.execute(async () => {
        const completion = await execution.operation();
        if (completion.status === 'AUTHENTICATED') {
          this.confirmSuccess(reservation);
          return completion.value;
        }
        if (completion.status === 'DETERMINED_REJECTION') {
          this.commit(reservation);
        } else {
          this.refund(reservation);
        }
        throw completion.error;
      }, execution.signal);
    } catch (error) {
      this.refund(reservation);
      if (error instanceof Argon2ExecutionError) {
        throw serviceUnavailable();
      }
      throw error;
    }
  }

  private reserve(identityKey: IdentityKey, ipKey: TrustedIpKey): Reservation {
    const now = this.time.now();
    this.cleanupIncrementally(now);

    const existingIdentity = this.identityBuckets.get(identityKey);
    const existingIp = this.ipBuckets.get(ipKey);
    if (
      (!existingIdentity && !this.ensureIdentitySlot(identityKey, now)) ||
      (!existingIp && !this.ensureIpSlot(ipKey, now))
    ) {
      throw serviceUnavailable();
    }

    const identity = existingIdentity ?? this.newBucket(IDENTITY_CAPACITY, now);
    const ip = existingIp ?? this.newBucket(IP_CAPACITY, now);
    this.refill(identity, IDENTITY_CAPACITY, IDENTITY_REFILL_MS, now);
    this.refill(ip, IP_CAPACITY, IP_REFILL_MS, now);

    if (identity.tokens === 0 || ip.tokens === 0) {
      const identityWait =
        identity.tokens === 0
          ? this.retryAfter(identity, IDENTITY_REFILL_MS, now)
          : 0;
      const ipWait =
        ip.tokens === 0 ? this.retryAfter(ip, IP_REFILL_MS, now) : 0;
      throw new LoginAdmissionError(
        LOGIN_ADMISSION_ERROR_CODE.RATE_LIMITED,
        Math.max(identityWait, ipWait),
      );
    }

    if (!existingIdentity) {
      this.identityBuckets.set(identityKey, identity);
    }
    if (!existingIp) {
      this.ipBuckets.set(ipKey, ip);
    }

    const id = Symbol('LOGIN_ADMISSION_RESERVATION');
    identity.tokens -= 1;
    ip.tokens -= 1;
    identity.reservations.set(id, identity.generation);
    ip.reservations.set(id, ip.generation);
    return {
      state: 'OPEN',
      id,
      identityKey,
      identity: { bucket: identity, generation: identity.generation },
      ip: { bucket: ip, generation: ip.generation },
    };
  }

  private newBucket(capacity: number, now: number): Bucket {
    return {
      tokens: capacity,
      lastRefillMs: now,
      generation: 0,
      reservations: new Map(),
    };
  }

  private refill(
    bucket: Bucket,
    capacity: number,
    intervalMs: number,
    now: number,
  ): void {
    if (now <= bucket.lastRefillMs) {
      return;
    }
    if (bucket.tokens >= capacity) {
      bucket.lastRefillMs = now;
      return;
    }
    const intervals = Math.floor((now - bucket.lastRefillMs) / intervalMs);
    if (intervals === 0) {
      return;
    }
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

  private commit(reservation: Reservation): void {
    if (reservation.state !== 'OPEN') {
      return;
    }
    reservation.state = 'COMMITTED';
    reservation.identity.bucket.reservations.delete(reservation.id);
    reservation.ip.bucket.reservations.delete(reservation.id);
  }

  private refund(reservation: Reservation): void {
    if (reservation.state !== 'OPEN') {
      return;
    }
    reservation.state = 'REFUNDED';
    this.refundBucket(reservation.id, reservation.identity, IDENTITY_CAPACITY);
    this.refundBucket(reservation.id, reservation.ip, IP_CAPACITY);
  }

  private refundBucket(
    id: symbol,
    reservation: BucketReservation,
    capacity: number,
  ): void {
    reservation.bucket.reservations.delete(id);
    if (reservation.bucket.generation === reservation.generation) {
      reservation.bucket.tokens = Math.min(
        capacity,
        reservation.bucket.tokens + 1,
      );
    }
  }

  private confirmSuccess(reservation: Reservation): void {
    if (reservation.state !== 'OPEN') {
      return;
    }
    reservation.state = 'COMMITTED';
    const identity = reservation.identity.bucket;
    identity.reservations.delete(reservation.id);
    reservation.ip.bucket.reservations.delete(reservation.id);
    identity.generation += 1;
    identity.tokens = IDENTITY_CAPACITY;
    identity.lastRefillMs = this.time.now();
    if (identity.reservations.size === 0) {
      this.identityBuckets.delete(reservation.identityKey);
    }
  }

  private ensureIdentitySlot(key: IdentityKey, now: number): boolean {
    if (this.identityBuckets.has(key)) {
      return true;
    }
    if (this.identityBuckets.size < this.config.identityBucketsMax) {
      return true;
    }
    this.cleanupAll(
      this.identityBuckets,
      IDENTITY_CAPACITY,
      IDENTITY_REFILL_MS,
      now,
    );
    this.identityCleanupIterator = undefined;
    return this.identityBuckets.size < this.config.identityBucketsMax;
  }

  private ensureIpSlot(key: TrustedIpKey, now: number): boolean {
    if (this.ipBuckets.has(key)) {
      return true;
    }
    if (this.ipBuckets.size < this.config.ipBucketsMax) {
      return true;
    }
    this.cleanupAll(this.ipBuckets, IP_CAPACITY, IP_REFILL_MS, now);
    this.ipCleanupIterator = undefined;
    return this.ipBuckets.size < this.config.ipBucketsMax;
  }

  private cleanupIncrementally(now: number): void {
    this.identityCleanupIterator = this.cleanupSome(
      this.identityBuckets,
      IDENTITY_CAPACITY,
      IDENTITY_REFILL_MS,
      now,
      this.identityCleanupIterator,
    );
    this.ipCleanupIterator = this.cleanupSome(
      this.ipBuckets,
      IP_CAPACITY,
      IP_REFILL_MS,
      now,
      this.ipCleanupIterator,
    );
  }

  private cleanupSome<K extends BucketKey>(
    buckets: Map<K, Bucket>,
    capacity: number,
    intervalMs: number,
    now: number,
    currentIterator: MapIterator<[K, Bucket]> | undefined,
  ): MapIterator<[K, Bucket]> | undefined {
    const iterator = currentIterator ?? buckets.entries();
    for (
      let inspected = 0;
      inspected < INCREMENTAL_CLEANUP_LIMIT;
      inspected += 1
    ) {
      const entry = iterator.next();
      if (entry.done) {
        return undefined;
      }
      const [key, bucket] = entry.value;
      this.refill(bucket, capacity, intervalMs, now);
      if (this.isRemovable(bucket, capacity)) {
        buckets.delete(key);
      }
    }
    return iterator;
  }

  private cleanupAll<K extends BucketKey>(
    buckets: Map<K, Bucket>,
    capacity: number,
    intervalMs: number,
    now: number,
  ): void {
    for (const [key, bucket] of buckets) {
      this.refill(bucket, capacity, intervalMs, now);
      if (this.isRemovable(bucket, capacity)) {
        buckets.delete(key);
      }
    }
  }

  private isRemovable(bucket: Bucket, capacity: number): boolean {
    return bucket.tokens === capacity && bucket.reservations.size === 0;
  }
}
