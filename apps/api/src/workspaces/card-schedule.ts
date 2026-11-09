import { HTTP_ERROR_CODE, HttpContractError } from '../http/http-errors.js';

export type CardScheduleChange =
  { startDate: Date | null; dueDate: Date | null } | { completed: boolean };

export function parseCivilDate(value: unknown): Date | null {
  if (value === null) return null;
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    !value.startsWith('0000')
  ) {
    const date = new Date(value + 'T00:00:00.000Z');
    if (Number.isFinite(date.getTime()) && civilDate(date) === value)
      return date;
  }
  throw new HttpContractError(HTTP_ERROR_CODE.INVALID_REQUEST);
}

export function civilDate(date: Date | null) {
  return date === null ? null : date.toISOString().slice(0, 10);
}

export function workspaceToday(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts
    .find(({ type }) => type === 'year')!
    .value.padStart(4, '0');
  const month = parts.find(({ type }) => type === 'month')!.value;
  const day = parts.find(({ type }) => type === 'day')!.value;
  return year + '-' + month + '-' + day;
}

export function scheduleView(
  card: {
    startDate: Date | null;
    dueDate: Date | null;
    completedAt: Date | null;
    completedById: string | null;
  },
  overdue: boolean,
) {
  return {
    startDate: civilDate(card.startDate),
    dueDate: civilDate(card.dueDate),
    completedAt: card.completedAt?.toISOString() ?? null,
    completedById: card.completedById,
    overdue,
  };
}
