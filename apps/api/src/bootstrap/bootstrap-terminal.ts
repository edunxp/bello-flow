import { StringDecoder } from 'node:string_decoder';
import { createInterface } from 'node:readline';

export class BootstrapTerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapTerminalError';
  }
}

export class BootstrapTerminalInterruptedError extends BootstrapTerminalError {
  constructor() {
    super('Bootstrap terminal input was interrupted');
    this.name = 'BootstrapTerminalInterruptedError';
  }
}

export interface BootstrapTerminalStreams {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  error: NodeJS.WriteStream;
}

export class BootstrapTerminal {
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.WriteStream;
  private readonly error: NodeJS.WriteStream;

  constructor(
    streams: BootstrapTerminalStreams = {
      input: process.stdin,
      output: process.stdout,
      error: process.stderr,
    },
  ) {
    this.input = streams.input;
    this.output = streams.output;
    this.error = streams.error;
  }

  assertInteractive(): void {
    if (!this.input.isTTY || !this.output.isTTY) {
      throw new BootstrapTerminalError(
        'Bootstrap administration requires an interactive TTY',
      );
    }
  }

  promptText(prompt: string): Promise<string> {
    this.assertInteractive();

    return new Promise((resolve, reject) => {
      const terminal = createInterface({
        input: this.input,
        output: this.output,
        terminal: true,
      });
      const interrupt = () => {
        terminal.close();
        reject(new BootstrapTerminalInterruptedError());
      };

      terminal.once('SIGINT', interrupt);
      terminal.question(prompt, (answer) => {
        terminal.off('SIGINT', interrupt);
        terminal.close();
        resolve(answer);
      });
    });
  }

  promptSecret(prompt: string): Promise<string> {
    this.assertInteractive();

    return new Promise((resolve, reject) => {
      const decoder = new StringDecoder('utf8');
      const wasRaw = this.input.isRaw ?? false;
      const wasPaused = this.input.isPaused();
      const interruptionSignals: NodeJS.Signals[] = [
        'SIGINT',
        'SIGTERM',
        'SIGHUP',
      ];
      let value = '';

      const restore = () => {
        this.input.off('data', receive);
        for (const signal of interruptionSignals) {
          process.off(signal, interrupt);
        }
        if (!wasRaw) {
          this.input.setRawMode(false);
        }
        if (wasPaused) {
          this.input.pause();
        }
      };
      const finish = (error?: Error) => {
        restore();
        this.output.write('\n');
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      const interrupt = () => finish(new BootstrapTerminalInterruptedError());
      const receive = (chunk: Buffer | string) => {
        const text =
          typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
        for (const character of text) {
          if (character === '\u0003' || character === '\u0004') {
            interrupt();
            return;
          }
          if (character === '\r' || character === '\n') {
            finish();
            return;
          }
          if (character === '\u0008' || character === '\u007f') {
            const codePoints = Array.from(value);
            codePoints.pop();
            value = codePoints.join('');
          } else {
            value += character;
          }
        }
      };

      this.input.on('data', receive);
      for (const signal of interruptionSignals) {
        process.once(signal, interrupt);
      }
      try {
        this.input.setRawMode(true);
        this.input.resume();
        this.output.write(prompt);
      } catch (error) {
        restore();
        reject(error);
      }
    });
  }

  writeLine(message = ''): void {
    this.output.write(`${message}\n`);
  }

  writeError(message: string): void {
    this.error.write(`${message}\n`);
  }
}
