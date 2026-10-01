import { Service } from '@angular/core';
import routesJson from '@content/routes.json';
import siteJson from '@content/site.json';
import type { Lang, MediaRef, NavItem, PageKind, RouteTable, Site } from '@schema/content';

/** Site-wide content from the synced snapshot (validated at sync time). */
const SITE = siteJson as unknown as Site;
const ROUTES = (routesJson as unknown as RouteTable).routes;

export const routeTable = ROUTES;

@Service()
export class ContentStore {
  readonly site: Site = SITE;
  readonly routes = ROUTES;

  /** Path of the first page of a kind in a language's tree, e.g. the contact page. */
  pathOf(kind: PageKind, lang: Lang = 'en'): string | undefined {
    return this.routes.find((route) => route.kind === kind && (route.lang ?? 'en') === lang)?.path;
  }

  /** The home page of a language's tree. */
  homePath(lang: Lang = 'en'): string {
    return this.pathOf('home', lang) ?? '/';
  }

  navigation(lang: Lang = 'en'): { header: NavItem[]; footer: NavItem[] } {
    return (lang === 'ar' ? this.site.i18n?.ar?.navigation : undefined) ?? this.site.navigation;
  }

  tagline(lang: Lang = 'en'): string | undefined {
    return (lang === 'ar' ? this.site.i18n?.ar?.tagline : undefined) ?? this.site.tagline;
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
