import { Module } from '@nestjs/common';
import { PasswordCredentialService } from '../credentials/password-credential.service.js';
import { BootstrapCliRunner } from './bootstrap-cli.runner.js';
import { BootstrapPostgresProvider } from './bootstrap-postgres.provider.js';
import { BootstrapReconciliationRunner } from './bootstrap-reconciliation.runner.js';
import { BootstrapTerminal } from './bootstrap-terminal.js';

@Module({
  providers: [
    PasswordCredentialService,
    BootstrapPostgresProvider,
    BootstrapCliRunner,
    BootstrapReconciliationRunner,
    {
      provide: BootstrapTerminal,
      useFactory: () => new BootstrapTerminal(),
    },
  ],
})
export class BootstrapCliModule {}
