import { ApplicationRef } from '@angular/core';

const bootstrapMock = vi.hoisted(() => vi.fn());

vi.mock('@angular/platform-browser', async (importOriginal) => {
  const original = await importOriginal<typeof import('@angular/platform-browser')>();

  return {
    ...original,
    bootstrapApplication: bootstrapMock,
  };
});

describe('application bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    bootstrapMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bootstraps the root component with the application configuration', async () => {
    bootstrapMock.mockResolvedValue({} as ApplicationRef);
    const [{ App }, { appConfig }] = await Promise.all([
      import('./app/app'),
      import('./app/app.config'),
    ]);

    await import('./main');

    expect(bootstrapMock).toHaveBeenCalledWith(App, appConfig);
  });

  it('reports bootstrap failures', async () => {
    const error = new Error('bootstrap failed');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    bootstrapMock.mockRejectedValue(error);

    await import('./main');
    await Promise.resolve();

    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
