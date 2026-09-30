import { Service } from '@angular/core';
import routesJson from '@content/routes.json';
import siteJson from '@content/site.json';
import type { MediaRef, PageKind, RouteTable, Site } from '@schema/content';

/** Site-wide content from the synced snapshot (validated at sync time). */
const SITE = siteJson as unknown as Site;
const ROUTES = (routesJson as unknown as RouteTable).routes;

export const routeTable = ROUTES;

@Service()
export class ContentStore {
  readonly site: Site = SITE;
  readonly routes = ROUTES;

  /** Path of the first page of a kind, e.g. the contact page. */
  pathOf(kind: PageKind): string | undefined {
    return this.routes.find((route) => route.kind === kind)?.path;
  }

  siteMedia(id: string | undefined): MediaRef | undefined {
    return id ? this.site.media[id] : undefined;
  }

  get logo(): MediaRef | undefined {
    return this.siteMedia(this.site.logo);
  }

  get primaryPhone(): Site['contact']['phones'][number] | undefined {
    return this.site.contact.phones[0];
  }

  get primaryEmail(): string | undefined {
    return this.site.contact.emails[0];
  }
}
