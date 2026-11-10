import { InjectionToken } from '@angular/core';

export const backgroundHeaders = {
  'X-Bello-Flow-Request': '1',
  'X-Bello-Flow-Background': '1',
};

export function connectBoardRealtime(
  contentPath: string,
  revisionReceived: (revision: number) => void,
  accessRevoked: () => void,
): () => void {
  const [, , , workspaceId, , boardId] = contentPath.split('/');
  if (!workspaceId || !boardId) return () => undefined;
  const url = new URL('/api/realtime', window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = new URLSearchParams({ workspaceId, boardId }).toString();

  let closed = false;
  let delay = 1000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  const schedule = () => {
    if (closed) return;
    retry = setTimeout(connect, delay);
    delay = Math.min(delay * 2, 16000);
  };
  function connect() {
    try {
      socket = new WebSocket(url);
    } catch {
      schedule();
      return;
    }
    socket.onmessage = (event) => {
      if (closed || typeof event.data !== 'string') return;
      try {
        const notice = JSON.parse(event.data) as { boardId?: unknown; revision?: unknown } | null;
        const revision = notice?.revision;
        if (
          notice?.boardId !== boardId ||
          typeof revision !== 'number' ||
          !Number.isSafeInteger(revision) ||
          revision < 0
        )
          return;
        delay = 1000;
        revisionReceived(revision);
      } catch {
        // A malformed notice never replaces the authorized HTTP state.
      }
    };
    socket.onclose = (event) => {
      if (closed) return;
      if (event.code === 1008) {
        closed = true;
        accessRevoked();
        return;
      }
      schedule();
    };
  }
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    socket?.close();
  };
}

export const BOARD_REALTIME = new InjectionToken<typeof connectBoardRealtime>('Board realtime', {
  factory: () => connectBoardRealtime,
});
