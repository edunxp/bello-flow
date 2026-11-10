import type { PrismaService } from '../prisma/prisma.service.js';
import { AuditQueryService } from './audit-query.service.js';

const filters = {
  from: null,
  until: null,
  entityType: null,
  entityId: null,
  operation: null,
  result: null,
  actor: null,
  cursorAt: null,
  cursorId: null,
};

function setup() {
  const db = { $queryRaw: vi.fn(), auditEvent: { createMany: vi.fn() } };
  const service = new AuditQueryService(db as unknown as PrismaService);
  return {
    db,
    query: () => service.query('actor', 'GLOBAL', null, null, filters),
  };
}

describe('AuditQueryService', () => {
  it('uses the final visible event as the next cursor without truncating precision', async () => {
    const { db, query } = setup();
    const occurredAt = '2026-01-01T00:00:00.123456+00:00';
    const rows = Array.from({ length: 31 }, (_, index) => ({
      event: { occurredAt, id: String(index) },
    }));
    db.$queryRaw.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);
    const result = await query();
    expect(result.events).toHaveLength(30);
    expect(result.next).toEqual({ cursorAt: occurredAt, cursorId: '29' });
    await expect(query()).resolves.toEqual({ events: [], next: null });
  });

  it('does not disclose a restricted audit identifier in the history cursor', async () => {
    const { db } = setup();
    const service = new AuditQueryService(db as unknown as PrismaService);
    const occurredAt = '2026-01-01T00:00:00.123456+00:00';
    db.$queryRaw.mockResolvedValue(
      Array.from({ length: 31 }, () => ({
        event: { occurredAt, restricted: true },
      })),
    );
    const result = await service.query(
      'actor',
      'CONTENT',
      'workspace',
      'board',
      filters,
      {
        cardId: 'card',
        before: occurredAt,
        offset: 30,
      },
    );
    expect(result.next).toEqual({ before: occurredAt, offset: 60 });
  });

  it('records denials with minimal metadata and propagates unrelated database errors', async () => {
    const { db, query } = setup();
    const unavailable = new Error('unavailable');
    db.$queryRaw
      .mockRejectedValueOnce(unavailable)
      .mockResolvedValueOnce([{ event: { denied: true } }]);
    await expect(query()).rejects.toBe(unavailable);
    await expect(query()).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    expect(db.auditEvent.createMany).toHaveBeenCalledOnce();
    expect(db.auditEvent.createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorAccountId: 'actor',
        result: 'DENIED',
      }),
    });
  });
});
