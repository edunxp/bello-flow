import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AuthPage } from './auth-page';
import { Home } from './home';
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideRouter([
      { path: '', component: Home },
      { path: 'login', component: AuthPage, data: { mode: 'login' } },
      { path: 'forgot-password', component: AuthPage, data: { mode: 'recover' } },
      { path: 'reset-password', component: AuthPage, data: { mode: 'reset' } },
      { path: '**', redirectTo: '' },
    ]),
  ],
};
