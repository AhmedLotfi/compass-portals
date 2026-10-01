import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import type { PageKind } from '@schema/content';
import { routeTable } from './core/content/content';
import { pageResolver } from './core/content/page-resolver';
import { Lang } from './core/i18n/lang';

/** The 404 page (served as /404.html for every unknown URL) is English. */
const englishPage = () => {
  const lang = inject(Lang);
  lang.current.set('en');
  lang.path.set(undefined);
  return 'en';
};

type LoadComponent = NonNullable<Routes[number]['loadComponent']>;

const home: LoadComponent = () => import('./features/home/home').then((m) => m.Home);
const listing: LoadComponent = () => import('./features/listing/listing').then((m) => m.Listing);
const product: LoadComponent = () => import('./features/product/product').then((m) => m.Product);
const contentPage: LoadComponent = () =>
  import('./features/content-page/content-page').then((m) => m.ContentPage);
const contact: LoadComponent = () => import('./features/contact/contact').then((m) => m.Contact);
const notFound: LoadComponent = () =>
  import('./features/not-found/not-found').then((m) => m.NotFound);

const COMPONENT_FOR: Record<PageKind, LoadComponent> = {
  home,
  'product-index': listing,
  'product-category': listing,
  'service-index': listing,
  product,
  service: contentPage,
  page: contentPage,
  post: contentPage,
  contact,
};

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

/** One static route per synced page, so every page is prerendered at its own path. */
export const routes: Routes = [
  ...devRoutes,
  ...routeTable.map((entry) => ({
    path: entry.path.replace(/^\/|\/$/g, ''),
    pathMatch: 'full' as const,
    loadComponent: COMPONENT_FOR[entry.kind],
    resolve: { page: pageResolver },
    data: { pageId: entry.id, lang: entry.lang ?? 'en' },
  })),
  {
    path: '404',
    loadComponent: notFound,
    data: { notFound: true },
    resolve: { lang: englishPage },
  },
  { path: '**', loadComponent: notFound, data: { notFound: true }, resolve: { lang: englishPage } },
];
