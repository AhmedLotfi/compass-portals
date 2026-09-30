import { inject } from '@angular/core';
import { RedirectCommand, Router, type ResolveFn } from '@angular/router';
import { pageLoaders } from '@content/page-loaders';
import type { PageDoc } from '@schema/content';

/** Loads the page document for the route's `pageId`; unknown ids go to the 404 page. */
export const pageResolver: ResolveFn<PageDoc> = (route) => {
  const load = pageLoaders[route.data['pageId'] as string];
  if (!load) {
    return new RedirectCommand(inject(Router).parseUrl('/404'), { skipLocationChange: true });
  }
  return load();
};
