import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectBoardRealtime } from './board-realtime';

const path = '/api/workspaces/work/boards/board/lists';

function setup() {
  vi.useFakeTimers();
  const sockets: MockSocket[] = [];
  class MockSocket {
    onmessage?: (event: { data: unknown }) => void;
    onclose?: (event: { code: number }) => void;
    close = vi.fn();

    constructor(readonly url: URL) {
      sockets.push(this);
    }
  }
  vi.stubGlobal('WebSocket', MockSocket);
  const receive = vi.fn();
  const revoke = vi.fn();
  const stop = connectBoardRealtime(path, receive, revoke);
  return { sockets, receive, revoke, stop };
}

describe('board realtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses the current origin and accepts only valid revisions for the open board', () => {
    const { sockets, receive, stop } = setup();
    const socket = sockets[0];
    expect(socket.url.host).toBe(window.location.host);
    expect(socket.url.pathname + socket.url.search).toBe(
      '/api/realtime?workspaceId=work&boardId=board',
    );
    for (const data of [
      'bad JSON',
      null,
      'null',
      '{"boardId":"other","revision":1}',
      '{"boardId":"board","revision":-1}',
      '{"boardId":"board","revision":0.5}',
      '{"boardId":"board","revision":"1"}',
    ]) {
      socket.onmessage?.({ data });
    }
    expect(receive).not.toHaveBeenCalled();
    socket.onmessage?.({ data: '{"boardId":"board","revision":3}' });
    expect(receive).toHaveBeenCalledExactlyOnceWith(3);
    stop();
    expect(socket.close).toHaveBeenCalledOnce();
    socket.onmessage?.({ data: '{"boardId":"board","revision":4}' });
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it('backs off after failed connections and stops on revocation', () => {
    const { sockets, receive, revoke, stop } = setup();
    sockets[0].onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    sockets[1].onclose?.({ code: 1012 });
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    sockets[2].onmessage?.({ data: '{"boardId":"board","revision":7}' });
    expect(receive).toHaveBeenCalledExactlyOnceWith(7);
    sockets[2].onclose?.({ code: 1008 });
    expect(revoke).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(32000);
    expect(sockets).toHaveLength(3);
    stop();
  });
});
