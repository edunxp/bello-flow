import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch(() =>
  console.error('Não foi possível iniciar o Bello Flow'),
);
