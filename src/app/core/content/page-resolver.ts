import { inject } from '@angular/core';
import { RedirectCommand, Router, type ResolveFn } from '@angular/router';
import { pageLoaders } from '@content/page-loaders';
import type { Lang as LangCode, PageDoc } from '@schema/content';
import { Lang } from '../i18n/lang';

/**
 * Loads the page document for the route's `pageId`; unknown ids go to the 404 page. It also sets
 * the page's language before the page renders, so the layout (labels, direction) follows it.
 */
export const pageResolver: ResolveFn<PageDoc> = (route) => {
  const lang = inject(Lang);
  lang.current.set((route.data['lang'] as LangCode | undefined) ?? 'en');
  const load = pageLoaders[route.data['pageId'] as string];
  if (!load) {
    return new RedirectCommand(inject(Router).parseUrl('/404'), { skipLocationChange: true });
  }
  return load().then((page) => {
    lang.path.set(page.path);
    return page;
  });
};
