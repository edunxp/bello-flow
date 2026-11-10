import { createHash } from 'node:crypto';

export type CommentChange =
  | { kind: 'CREATE'; content: string }
  | { kind: 'EDIT'; id: string; version: string; content: string }
  | { kind: 'REMOVE'; id: string; version: string }
  | { kind: 'MODERATE'; id: string; version: string; justification: string };

export function commentVersion(comment: {
  content: string | null;
  createdAt: Date;
  editedAt: Date | null;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify([comment.createdAt, comment.editedAt, comment.content]),
    )
    .digest('hex');
}
