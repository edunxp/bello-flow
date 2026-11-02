import { spawn } from 'node:child_process';

function runPseudoTerminal(input: string): Promise<{
  code: number | null;
  output: string;
}> {
  return new Promise((resolve, reject) => {
    const command = `${process.execPath} --experimental-strip-types test/fixtures/secure-prompt.mjs`;
    const child = spawn('script', ['-qfec', command, '/dev/null'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let submitted = false;
    const receive = (chunk: Buffer) => {
      output += chunk.toString();
      if (!submitted && output.includes('Secret: ')) {
        submitted = true;
        child.stdin.end(input);
      }
    };

    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
}

describe('BootstrapTerminal pseudo-TTY security', () => {
  it('does not echo a pasted secret or reveal its length', async () => {
    const result = await runPseudoTerminal('pasted secret 🚀\r');

    expect(result.code).toBe(0);
    expect(result.output).toContain('Secret: ');
    expect(result.output).toContain('accepted');
    expect(result.output).not.toContain('pasted secret');
    expect(result.output).not.toMatch(/\*+/);
  });

  it('restores the pseudo-terminal after Ctrl+C', async () => {
    const result = await runPseudoTerminal('\u0003');

    expect(result.code).toBe(1);
    expect(result.output).toContain('interrupted');
    expect(result.output).not.toContain('pasted secret');
  });
});
