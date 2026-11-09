import {
  parseCivilDate,
  scheduleView,
  workspaceToday,
} from './card-schedule.js';

describe('card scheduling', () => {
  it('round-trips valid civil dates and rejects invalid or normalized dates', () => {
    expect(parseCivilDate(null)).toBeNull();
    expect(parseCivilDate('2024-02-29')?.toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
    for (const value of [
      undefined,
      '',
      '0000-01-01',
      '2025-02-29',
      '2024-04-31',
      '2026-13-01',
      '2026-1-01',
      '2026-01-01T00:00:00Z',
    ]) {
      expect(() => parseCivilDate(value)).toThrow('INVALID_REQUEST');
    }
  });

  it('resolves the civil day across a DST boundary and serializes dates', () => {
    const card = {
      startDate: null,
      dueDate: parseCivilDate('2026-03-08'),
      completedAt: null,
      completedById: null,
    };
    const before = new Date('2026-03-09T06:59:59.999Z');
    const midnight = new Date('2026-03-09T07:00:00.000Z');
    expect(workspaceToday('America/Los_Angeles', before)).toBe('2026-03-08');
    expect(workspaceToday('America/Los_Angeles', midnight)).toBe('2026-03-09');
    expect(scheduleView(card, true)).toMatchObject({
      dueDate: '2026-03-08',
      overdue: true,
    });
    expect(scheduleView({ ...card, dueDate: null }, false).dueDate).toBeNull();
    expect(
      scheduleView(
        { ...card, completedAt: before, completedById: 'actor' },
        false,
      ),
    ).toEqual({
      startDate: null,
      dueDate: '2026-03-08',
      overdue: false,
      completedAt: before.toISOString(),
      completedById: 'actor',
    });
  });
});
