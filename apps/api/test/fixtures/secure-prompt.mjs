import { BootstrapTerminal } from '../../src/bootstrap/bootstrap-terminal.ts';

const expected = 'pasted secret 🚀';
const terminal = new BootstrapTerminal();

try {
  const secret = await terminal.promptSecret('Secret: ');
  if (secret !== expected) {
    process.exitCode = 2;
  } else {
    process.stdout.write('accepted\n');
  }
} catch {
  process.stdout.write('interrupted\n');
  process.exitCode = 1;
}
