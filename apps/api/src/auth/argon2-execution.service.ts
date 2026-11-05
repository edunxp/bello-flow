import { Inject, Injectable } from '@nestjs/common';
import {
  LOGIN_ADMISSION_CONFIG,
  type LoginAdmissionConfig,
} from './login-admission.config.js';
import { ADMISSION_TIME, type AdmissionTime } from './admission-time.js';

export const ARGON2_EXECUTION_ERROR_CODE = Object.freeze({
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const);

export class Argon2ExecutionError extends Error {
  readonly code = ARGON2_EXECUTION_ERROR_CODE.SERVICE_UNAVAILABLE;

  constructor() {
    super(ARGON2_EXECUTION_ERROR_CODE.SERVICE_UNAVAILABLE);
    this.name = 'Argon2ExecutionError';
  }
}

type WaiterState = 'QUEUED' | 'ACQUIRED' | 'TIMED_OUT' | 'CANCELLED';

type Waiter = {
  state: WaiterState;
  readonly resolve: () => void;
  readonly reject: (error: Argon2ExecutionError) => void;
  readonly signal?: AbortSignal;
  cancelTimeout?: () => void;
  onAbort?: () => void;
};

function serviceUnavailable(): Argon2ExecutionError {
  return new Argon2ExecutionError();
}

@Injectable()
export class Argon2ExecutionService {
  private activeExecutions = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    @Inject(LOGIN_ADMISSION_CONFIG)
    private readonly config: LoginAdmissionConfig,
    @Inject(ADMISSION_TIME)
    private readonly time: AdmissionTime,
  ) {}

  async execute<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    await this.acquire(signal);
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(serviceUnavailable());
    }
    if (this.activeExecutions < this.config.concurrency) {
      this.activeExecutions += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.config.queueMax) {
      return Promise.reject(serviceUnavailable());
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { state: 'QUEUED', resolve, reject, signal };
      waiter.onAbort = () => {
        this.finishWaiting(waiter, 'CANCELLED', serviceUnavailable());
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      waiter.cancelTimeout = this.time.schedule(() => {
        this.finishWaiting(waiter, 'TIMED_OUT', serviceUnavailable());
      }, this.config.waitTimeoutMs);
    });
  }

  private finishWaiting(
    waiter: Waiter,
    state: Exclude<WaiterState, 'QUEUED'>,
    error?: Argon2ExecutionError,
  ): boolean {
    if (waiter.state !== 'QUEUED') {
      return false;
    }
    waiter.state = state;
    waiter.cancelTimeout?.();
    if (waiter.onAbort) {
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
    }
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
    if (state === 'ACQUIRED') {
      waiter.resolve();
    } else {
      waiter.reject(error ?? serviceUnavailable());
    }
    return true;
  }

  private release(): void {
    this.activeExecutions -= 1;
    while (this.waiters.length > 0) {
      const waiter = this.waiters[0]!;
      if (this.finishWaiting(waiter, 'ACQUIRED')) {
        this.activeExecutions += 1;
        return;
      }
      this.waiters.shift();
    }
  }
}
