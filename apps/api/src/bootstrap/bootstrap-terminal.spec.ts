import { PassThrough } from 'node:stream';
import {
  BootstrapTerminal,
  BootstrapTerminalInterruptedError,
  BootstrapTerminalError,
} from './bootstrap-terminal.js';

type FakeInput = PassThrough &
  Pick<NodeJS.ReadStream, 'isTTY' | 'isRaw'> & {
    setRawMode: ReturnType<typeof vi.fn<(mode: boolean) => NodeJS.ReadStream>>;
  };
type FakeOutput = PassThrough & Pick<NodeJS.WriteStream, 'isTTY'>;

function terminalFixture(options: { raw?: boolean; tty?: boolean } = {}) {
  const input = new PassThrough() as FakeInput;
  input.isTTY = options.tty ?? true;
  input.isRaw = options.raw ?? false;
  input.setRawMode = vi.fn((mode: boolean) => {
    input.isRaw = mode;
    return input as unknown as NodeJS.ReadStream;
  });
  const output = new PassThrough() as FakeOutput;
  output.isTTY = options.tty ?? true;
  const error = new PassThrough() as FakeOutput;
  error.isTTY = options.tty ?? true;
  let stdout = '';
  let stderr = '';
  output.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  error.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  return {
    input,
    output,
    error,
    terminal: new BootstrapTerminal({
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream,
      error: error as unknown as NodeJS.WriteStream,
    }),
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe('BootstrapTerminal', () => {
  it('rejects non-interactive streams', () => {
    const fixture = terminalFixture({ tty: false });

    expect(() => fixture.terminal.assertInteractive()).toThrow(
      BootstrapTerminalError,
    );
  });

  it('reads visible text through the terminal', async () => {
    const fixture = terminalFixture();
    const answer = fixture.terminal.promptText('Nome: ');

    fixture.input.write('Ada\n');

    await expect(answer).resolves.toBe('Ada');
    expect(fixture.stdout()).toContain('Nome: ');
  });

  it('handles interruption during visible input', async () => {
    const fixture = terminalFixture();
    const answer = fixture.terminal.promptText('Nome: ');

    fixture.input.write('\u0003');

    await expect(answer).rejects.toBeInstanceOf(
      BootstrapTerminalInterruptedError,
    );
  });

  it('reads pasted secrets without echo or length masking', async () => {
    const fixture = terminalFixture();
    const secret = fixture.terminal.promptSecret('Senha: ');

    fixture.input.write('pasted secret 🚀\r');

    await expect(secret).resolves.toBe('pasted secret 🚀');
    expect(fixture.stdout()).toBe('Senha: \n');
    expect(fixture.input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(fixture.input.setRawMode).toHaveBeenNthCalledWith(2, false);
  });

  it('supports string chunks when the prior raw state is unavailable', async () => {
    const fixture = terminalFixture();
    Reflect.deleteProperty(fixture.input, 'isRaw');
    fixture.input.setEncoding('utf8');
    const secret = fixture.terminal.promptSecret('Senha: ');

    fixture.input.write('string secret\n');

    await expect(secret).resolves.toBe('string secret');
    expect(fixture.input.isRaw).toBe(false);
  });

  it('handles backspace by Unicode code point', async () => {
    const fixture = terminalFixture();
    fixture.input.pause();
    const secret = fixture.terminal.promptSecret('Senha: ');

    fixture.input.write('secret🚀\u007fvalue\n');

    await expect(secret).resolves.toBe('secretvalue');
    expect(fixture.input.isPaused()).toBe(true);
  });

  it.each(['\u0003', '\u0004'])(
    'restores the terminal after interruption %#',
    async (control) => {
      const fixture = terminalFixture();
      const secret = fixture.terminal.promptSecret('Senha: ');

      fixture.input.write(control);

      await expect(secret).rejects.toBeInstanceOf(
        BootstrapTerminalInterruptedError,
      );
      expect(fixture.input.isRaw).toBe(false);
      expect(fixture.stdout()).toBe('Senha: \n');
    },
  );

  it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
    'restores the terminal after process signal %s',
    async (signal) => {
      const fixture = terminalFixture();
      const secret = fixture.terminal.promptSecret('Senha: ');

      process.emit(signal, signal);

      await expect(secret).rejects.toBeInstanceOf(
        BootstrapTerminalInterruptedError,
      );
      expect(fixture.input.isRaw).toBe(false);
    },
  );

  it('preserves a terminal that was already in raw and flowing mode', async () => {
    const fixture = terminalFixture({ raw: true });
    fixture.input.resume();
    const secret = fixture.terminal.promptSecret('Senha: ');

    fixture.input.write('secure value\n');

    await expect(secret).resolves.toBe('secure value');
    expect(fixture.input.setRawMode).toHaveBeenCalledOnce();
    expect(fixture.input.setRawMode).toHaveBeenCalledWith(true);
    expect(fixture.input.isPaused()).toBe(false);
  });

  it('removes listeners when secure terminal setup fails', async () => {
    const fixture = terminalFixture();
    fixture.input.setRawMode.mockImplementation((mode: boolean) => {
      if (mode) {
        throw new Error('raw mode failed');
      }
      fixture.input.isRaw = false;
      return fixture.input as unknown as NodeJS.ReadStream;
    });

    await expect(fixture.terminal.promptSecret('Senha: ')).rejects.toThrow(
      'raw mode failed',
    );
    expect(fixture.input.listenerCount('data')).toBe(0);
    expect(fixture.input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it('writes ordinary and error lines to separate streams', () => {
    const fixture = terminalFixture();

    fixture.terminal.writeLine();
    fixture.terminal.writeLine('status');
    fixture.terminal.writeError('failure');

    expect(fixture.stdout()).toBe('\nstatus\n');
    expect(fixture.stderr()).toBe('failure\n');
  });
});
