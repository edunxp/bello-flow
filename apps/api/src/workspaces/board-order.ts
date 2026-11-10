import type { Prisma } from '../generated/prisma/client.js';
import { HTTP_ERROR_CODE, HttpContractError } from '../http/http-errors.js';

export const POSITION_STEP = 4_294_967_296n;
const POSITION_LIMIT = 9_000_000_000_000_000_000n;

export interface MoveIntent {
  itemId: string;
  sourceId: string;
  destinationId: string;
  itemRevision: number;
  sourceRevision: number;
  destinationRevision: number;
  leftId: string | null;
  rightId: string | null;
  operationId: string;
}

export type Container = { kind: 'LIST' | 'CARD'; id: string };
type Positioned = { id: string; position: bigint; archived?: boolean };

export function conflict(): never {
  throw new HttpContractError(HTTP_ERROR_CODE.OPERATION_CONFLICT);
}

export async function lockContainers(
  tx: Prisma.TransactionClient,
  containers: Container[],
) {
  const keys = [...new Set(containers.map(({ kind, id }) => kind + ':' + id))];
  // Lock in numeric key order, including in the unlikely event of a hash collision.
  await tx.$queryRaw`
    SELECT count(*) FROM (
      SELECT pg_advisory_xact_lock(lock_id)
      FROM (SELECT DISTINCT hashtextextended('bello-order:' || key, 0) AS lock_id
        FROM unnest(${keys}::text[]) AS keys(key) ORDER BY lock_id) ordered
    ) locked
  `;
}

export function siblings(
  tx: Prisma.TransactionClient,
  container: Container,
): Promise<Positioned[]> {
  const select = { id: true, position: true, archived: true } as const;
  const orderBy = { position: 'asc' } as const;
  return container.kind === 'LIST'
    ? tx.boardList.findMany({
        where: { boardId: container.id },
        select,
        orderBy,
      })
    : tx.boardCard.findMany({
        where: { listId: container.id },
        select,
        orderBy,
      });
}

export function placement(
  items: Positioned[],
  intent: MoveIntent,
  exact: boolean,
) {
  const left = items.findIndex(({ id }) => id === intent.leftId);
  const right = items.findIndex(({ id }) => id === intent.rightId);
  if (exact) {
    const index = intent.leftId === null ? 0 : left + 1;
    if (
      (intent.leftId !== null && left < 0) ||
      (intent.rightId === null ? index !== items.length : right !== index)
    )
      conflict();
    return index;
  }
  if (left >= 0) return left + 1;
  if (right >= 0) return right;
  if (intent.leftId === null && intent.rightId === null) return items.length;
  return conflict();
}

export function neighbors(items: Positioned[], index: number) {
  return {
    leftId: items[index - 1]?.id ?? null,
    rightId: items[index]?.id ?? null,
  };
}

export async function positionAt(
  tx: Prisma.TransactionClient,
  container: Container,
  items: Positioned[],
  index: number,
) {
  const left = items[index - 1]?.position ?? 0n;
  const right = items[index]?.position;
  const candidate =
    right === undefined ? left + POSITION_STEP : left + (right - left) / 2n;
  if (candidate > left && candidate <= POSITION_LIMIT) return candidate;

  // The window includes the moving item if it is already in this container.
  // Keeping it in the window avoids intermediate collisions with its old key.
  const previous = items[index - 1]?.id;
  const rebuilt = await rebalance(tx, container, previous);
  if (rebuilt > POSITION_LIMIT) return conflict();
  return rebuilt;
}

async function rebalance(
  tx: Prisma.TransactionClient,
  container: Container,
  previous?: string,
) {
  if (container.kind === 'LIST') {
    await tx.$queryRaw`
      SELECT id FROM board_list WHERE board_id = ${container.id}::uuid
      ORDER BY id FOR NO KEY UPDATE
    `;
  }
  const [result] =
    container.kind === 'LIST'
      ? await tx.$queryRaw<{ position: bigint }[]>`
      WITH ranked AS (
        SELECT id, row_number() OVER (ORDER BY position) * ${POSITION_STEP} AS position
        FROM board_list WHERE board_id = ${container.id}::uuid
      ), updated AS (
        UPDATE board_list item SET position = ranked.position FROM ranked
        WHERE item.id = ranked.id RETURNING item.id, item.position
      )
      SELECT coalesce(max(position) FILTER (WHERE id = ${previous ?? null}::uuid), 0) + ${POSITION_STEP / 2n} AS position
      FROM updated
    `
      : await tx.$queryRaw<{ position: bigint }[]>`
      WITH ranked AS (
        SELECT id, row_number() OVER (ORDER BY position) * ${POSITION_STEP} AS position
        FROM board_card WHERE list_id = ${container.id}::uuid
      ), updated AS (
        UPDATE board_card item SET position = ranked.position FROM ranked
        WHERE item.id = ranked.id RETURNING item.id, item.position
      )
      SELECT coalesce(max(position) FILTER (WHERE id = ${previous ?? null}::uuid), 0) + ${POSITION_STEP / 2n} AS position
      FROM updated
    `;
  return result!.position;
}

export async function advanceOrder(
  tx: Prisma.TransactionClient,
  boardId: string,
  kind: Container['kind'],
  ids: string[],
) {
  if (kind === 'CARD') {
    await tx.$queryRaw`
      SELECT id FROM board_list WHERE id = ANY(${ids}::uuid[])
      ORDER BY id FOR NO KEY UPDATE
    `;
    await tx.boardList.updateMany({
      where: { id: { in: ids } },
      data: { cardOrderRevision: { increment: 1 } },
    });
  }
  await tx.board.update({
    where: { id: boardId },
    select: { id: true },
    data: {
      syncRevision: { increment: 1 },
      ...(kind === 'LIST' ? { orderRevision: { increment: 1 } } : {}),
    },
  });
}
