import type { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, Subject, of } from 'rxjs';
import type { BoardRealtimeGateway } from './board-realtime.gateway.js';
import { RevisionNotificationInterceptor } from './revision-notification.interceptor.js';

function setup(
  method: string,
  path: string,
  params: Record<string, string> = {},
) {
  const invalidate = vi.fn();
  const interceptor = new RevisionNotificationInterceptor({
    invalidate,
  } as unknown as BoardRealtimeGateway);
  const context = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ method, path, params }) }),
  } as unknown as ExecutionContext;
  return { invalidate, interceptor, context };
}

it('queues the board check after a successful mutation response', async () => {
  const { invalidate, interceptor, context } = setup('PATCH', '/mutation', {
    workspaceId: 'work',
    boardId: 'board',
  });
  const response = new Subject<void>();
  const result = lastValueFrom(
    interceptor.intercept(context, { handle: () => response }),
  );
  expect(invalidate).not.toHaveBeenCalled();
  response.next();
  response.complete();
  await result;
  expect(invalidate).toHaveBeenCalledExactlyOnceWith('work', 'board');
});

it('does not notify for a failed mutation or an HTTP read', async () => {
  const { invalidate, interceptor, context } = setup('POST', '/mutation', {
    workspaceId: 'work',
  });
  const response = new Subject<void>();
  const result = lastValueFrom(
    interceptor.intercept(context, { handle: () => response }),
  );
  response.error(new Error('rollback'));
  await expect(result).rejects.toThrow('rollback');
  expect(invalidate).not.toHaveBeenCalled();
  const read = setup('GET', '/api/auth/logout');
  await lastValueFrom(
    read.interceptor.intercept(read.context, { handle: () => of(null) }),
  );
  expect(read.invalidate).not.toHaveBeenCalled();
});

it('rechecks sessions after logout and all affected boards after workspace changes', async () => {
  for (const [path, params, expected] of [
    ['/api/auth/logout', {}, []],
    ['/workspace', { workspaceId: 'work' }, ['work', undefined]],
  ] as const) {
    const { invalidate, interceptor, context } = setup('POST', path, params);
    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of(null) }),
    );
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(...expected);
  }
});
