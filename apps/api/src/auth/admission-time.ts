export const ADMISSION_TIME = Symbol('ADMISSION_TIME');

export interface AdmissionTime {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}

export const SYSTEM_ADMISSION_TIME: AdmissionTime = Object.freeze({
  now: () => performance.now(),
  schedule: (callback: () => void, delayMs: number) => {
    const timeout = setTimeout(callback, delayMs);
    return () => clearTimeout(timeout);
  },
});
