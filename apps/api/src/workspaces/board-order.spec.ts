import type { Prisma } from '../generated/prisma/client.js';
import {
  neighbors,
  placement,
  positionAt,
  POSITION_STEP,
  type MoveIntent,
} from './board-order.js';

describe('board ordering', () => {
  const items = [
    { id: 'a', position: 100n },
    { id: 'b', position: 200n },
  ];
  const base = { leftId: null, rightId: null } as MoveIntent;
  it('validates exact gaps and prefers surviving neighbors for stale intentions', () => {
    expect(placement(items, { ...base, rightId: 'a' }, true)).toBe(0);
    expect(placement(items, { ...base, leftId: 'b' }, true)).toBe(2);
    expect(placement(items, { ...base, leftId: 'a', rightId: 'b' }, true)).toBe(
      1,
    );
    expect(() => placement(items, base, true)).toThrow('OPERATION_CONFLICT');
    expect(() =>
      placement(items, { ...base, leftId: 'gone', rightId: 'a' }, true),
    ).toThrow('OPERATION_CONFLICT');
    expect(
      placement(items, { ...base, leftId: 'gone', rightId: 'a' }, false),
    ).toBe(0);
    expect(
      placement(items, { ...base, leftId: 'b', rightId: 'gone' }, false),
    ).toBe(2);
    expect(placement(items, base, false)).toBe(2);
    expect(() => placement(items, { ...base, rightId: 'gone' }, false)).toThrow(
      'OPERATION_CONFLICT',
    );
    expect(neighbors(items, 0)).toEqual({ leftId: null, rightId: 'a' });
    expect(neighbors(items, 2)).toEqual({ leftId: 'b', rightId: null });
  });

  it('uses exact integer midpoints and rebuilds only when the gap or range is exhausted', async () => {
    const query = vi.fn().mockResolvedValue([{ position: POSITION_STEP / 2n }]);
    const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    const card = { kind: 'CARD', id: 'list' } as const;
    const list = { kind: 'LIST', id: 'board' } as const;
    expect(await positionAt(tx, list, items, 1)).toBe(150n);
    expect(await positionAt(tx, list, items, 2)).toBe(200n + POSITION_STEP);
    expect(query).not.toHaveBeenCalled();
    expect(await positionAt(tx, card, [{ id: 'a', position: 1n }], 0)).toBe(
      POSITION_STEP / 2n,
    );
    expect(
      await positionAt(
        tx,
        list,
        [{ id: 'a', position: 9_000_000_000_000_000_000n }],
        1,
      ),
    ).toBe(POSITION_STEP / 2n);
    expect(query).toHaveBeenCalledTimes(3);
    query.mockResolvedValue([{ position: 9_000_000_000_000_000_001n }]);
    await expect(
      positionAt(tx, card, [{ id: 'a', position: 1n }], 0),
    ).rejects.toThrow('OPERATION_CONFLICT');
  });
});
