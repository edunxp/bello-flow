import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AccessSharing } from './access-sharing';
import { AuthPage } from './auth-page';
import { Home } from './home';
import { Workspaces } from './workspaces';
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideRouter([
      { path: '', component: Home },
      { path: 'login', component: AuthPage, data: { mode: 'login' } },
      { path: 'forgot-password', component: AuthPage, data: { mode: 'recover' } },
      { path: 'reset-password', component: AuthPage, data: { mode: 'reset' } },
      { path: 'notifications', component: AccessSharing, data: { central: true } },
      { path: 'workspaces/:workspaceId/boards/:boardId/members', component: AccessSharing },
      { path: 'workspaces/:workspaceId/members', component: AccessSharing },
      { path: 'workspaces/:workspaceId/boards/:boardId', component: Workspaces },
      { path: 'workspaces/:workspaceId', component: Workspaces },
      { path: 'workspaces', component: Workspaces },
      { path: '**', redirectTo: '' },
    ]),
  ],
};
