import type { Routes } from '@angular/router';

/** Development-only routes. `ngDevMode` is defined as false in production, so these are removed. */
const devRoutes: Routes =
  typeof ngDevMode === 'undefined' || ngDevMode
    ? [
        {
          path: 'design-lab',
          title: 'Design lab',
          loadComponent: () => import('./dev/design-lab/design-lab').then((m) => m.DesignLab),
        },
      ]
    : [];

export const routes: Routes = [...devRoutes];
