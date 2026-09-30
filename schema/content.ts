/**
 * The content model: everything the portal shows, as synced from compassint.org.
 *
 * The sync validates every file against these schemas before writing it. The Angular app only uses
 * the derived types (`import type`), so zod never ships to the browser.
 */
import { z } from 'zod';

/** Where a piece of metadata came from, so reviews can tell site data from derived values. */
export const ProvenanceSchema = z.enum([
  'yoast',
  'rankmath',
  'wordpress',
  'page',
  'derived',
  'microcopy',
]);

export const MediaSchema = z.object({
  /** Stable id derived from the file's content hash, e.g. `m-3f2a9c1b04`. */
  id: z.string().regex(/^m-[0-9a-f]{10}$/),
  /** The URL the file was downloaded from on the old site. */
  sourceUrl: z.url(),
  /** Path of the original inside source-archive/http. */
  archiveFile: z.string(),
  mime: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string(),
  altSource: z.enum(['wordpress', 'html', 'caption', 'derived', 'decorative']),
  caption: z.string().optional(),
  /** Widths generated as responsive variants (empty for SVG). */
  widths: z.array(z.number().int().positive()),
  svg: z.boolean(),
  /** Tiny blurred preview as a data URI, for photos. */
  placeholder: z.string().optional(),
  /** Ids of the pages that use this file. */
  usedOn: z.array(z.string()),
});

export const RichTextBlockSchema = z.object({
  type: z.literal('richText'),
  /** Sanitized HTML with internal links rewritten to the new paths. */
  html: z.string(),
});

export const FeatureListBlockSchema = z.object({
  type: z.literal('featureList'),
  title: z.string().optional(),
  items: z.array(
    z.object({
      title: z.string().optional(),
      html: z.string(),
      icon: z.string().optional(),
    }),
  ),
});

export const ModuleGridBlockSchema = z.object({
  type: z.literal('moduleGrid'),
  title: z.string().optional(),
  items: z.array(
    z.object({
      title: z.string(),
      html: z.string().optional(),
      media: z.string().optional(),
      icon: z.string().optional(),
      href: z.string().optional(),
      /** The card's link text exactly as on the site (e.g. its "read more" button). */
      linkLabel: z.string().optional(),
    }),
  ),
});

export const MediaBlockSchema = z.object({
  type: z.literal('media'),
  media: z.string(),
  caption: z.string().optional(),
  href: z.string().optional(),
});

export const GalleryBlockSchema = z.object({
  type: z.literal('gallery'),
  items: z.array(
    z.object({
      media: z.string(),
      caption: z.string().optional(),
      href: z.string().optional(),
    }),
  ),
});

export const LinkKindSchema = z.enum(['internal', 'external', 'document', 'phone', 'email']);

export const CtaBlockSchema = z.object({
  type: z.literal('cta'),
  /** The link text exactly as on the site. */
  label: z.string(),
  href: z.string(),
  kind: LinkKindSchema,
});

export const StatsBlockSchema = z.object({
  type: z.literal('stats'),
  items: z.array(z.object({ value: z.string(), label: z.string() })),
});

export const QuoteBlockSchema = z.object({
  type: z.literal('quote'),
  html: z.string(),
  cite: z.string().optional(),
});

export const EmbedBlockSchema = z.object({
  type: z.literal('embed'),
  provider: z.enum(['youtube', 'vimeo', 'map', 'other']),
  url: z.url(),
  title: z.string(),
});

export const ContactFormBlockSchema = z.object({
  type: z.literal('contactForm'),
  /** Field labels and names exactly as on the site's form. */
  fields: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      kind: z.enum(['text', 'email', 'tel', 'textarea', 'select']),
      required: z.boolean(),
      options: z.array(z.string()).optional(),
    }),
  ),
  submitLabel: z.string().optional(),
});

export const BlockSchema = z.discriminatedUnion('type', [
  RichTextBlockSchema,
  FeatureListBlockSchema,
  ModuleGridBlockSchema,
  MediaBlockSchema,
  GalleryBlockSchema,
  CtaBlockSchema,
  StatsBlockSchema,
  QuoteBlockSchema,
  EmbedBlockSchema,
  ContactFormBlockSchema,
]);

export const SectionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  blocks: z.array(BlockSchema),
});

export const PageKindSchema = z.enum([
  'home',
  'product-index',
  'product-category',
  'product',
  'service-index',
  'service',
  'contact',
  'page',
  'post',
]);

export const PageDocSchema = z.object({
  id: z.string(),
  kind: PageKindSchema,
  /** New path, with the old site's trailing slash kept. */
  path: z.string().regex(/^\/(?:[^\s?#]+\/)?$/),
  title: z.string(),
  sourceUrl: z.url(),
  wp: z
    .object({ type: z.string(), id: z.number().int(), modified: z.string().optional() })
    .optional(),
  seo: z.object({
    title: z.string().optional(),
    titleSource: ProvenanceSchema.optional(),
    description: z.string().optional(),
    descriptionSource: ProvenanceSchema.optional(),
    image: z.string().optional(),
    noindex: z.boolean().optional(),
  }),
  hero: z.object({
    title: z.string(),
    lede: z.string().optional(),
    media: z.string().optional(),
    ctas: z.array(z.object({ label: z.string(), href: z.string(), kind: LinkKindSchema })),
    /** Further slider headlines, kept so nothing from the old hero is lost. */
    highlights: z.array(z.string()).optional(),
  }),
  sections: z.array(SectionSchema),
  breadcrumbs: z.array(z.object({ label: z.string(), path: z.string() })),
});

export const RouteEntrySchema = z.object({
  id: z.string(),
  path: z.string(),
  kind: PageKindSchema,
  /** Router params for prerendering (all strings). */
  params: z.record(z.string(), z.string()),
  parentId: z.string().nullable(),
  order: z.number(),
  title: z.string(),
  /** Verbatim summary (WordPress excerpt or the page's first paragraph) for index pages. */
  summary: z.string().optional(),
  media: z.string().optional(),
  sourceUrl: z.url(),
  oldUrls: z.array(z.string()),
  modified: z.string().optional(),
});

export const RouteIndexSchema = z.object({
  routes: z.array(RouteEntrySchema),
});

export interface NavItem {
  label: string;
  /** Internal path (new URL) or an absolute external URL. */
  href: string;
  external: boolean;
  children: NavItem[];
}

export const NavItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.object({
    label: z.string(),
    href: z.string(),
    external: z.boolean(),
    children: z.array(NavItemSchema),
  }),
);

export const SiteSchema = z.object({
  name: z.string(),
  tagline: z.string().optional(),
  /** Canonical origin of the new site. */
  origin: z.url(),
  /** Where content was synced from. */
  source: z.url(),
  logo: z.string().optional(),
  icon: z.string().optional(),
  languages: z.array(z.object({ code: z.string(), dir: z.enum(['ltr', 'rtl']) })).min(1),
  navigation: z.object({
    header: z.array(NavItemSchema),
    footer: z.array(NavItemSchema),
  }),
  contact: z.object({
    emails: z.array(z.string()),
    phones: z.array(z.object({ display: z.string(), tel: z.string() })),
    address: z.array(z.string()),
    mapUrl: z.string().optional(),
  }),
  social: z.array(z.object({ network: z.string(), url: z.url() })),
  apps: z.array(z.object({ store: z.enum(['google-play', 'app-store']), url: z.url() })),
  footer: z.object({ copyright: z.string().optional() }),
  snapshot: z.object({
    syncedAt: z.string(),
    pages: z.number().int(),
    media: z.number().int(),
  }),
});

export const RedirectSchema = z.object({
  from: z.string(),
  to: z.string(),
  status: z.union([z.literal(301), z.literal(410)]),
  reason: z.string(),
});

export const RedirectsSchema = z.object({ redirects: z.array(RedirectSchema) });
export const MediaIndexSchema = z.object({ media: z.array(MediaSchema) });

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type Media = z.infer<typeof MediaSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type BlockType = Block['type'];
export type Section = z.infer<typeof SectionSchema>;
export type PageKind = z.infer<typeof PageKindSchema>;
export type PageDoc = z.infer<typeof PageDocSchema>;
export type RouteEntry = z.infer<typeof RouteEntrySchema>;
export type RouteIndex = z.infer<typeof RouteIndexSchema>;
export type Site = z.infer<typeof SiteSchema>;
export type Redirect = z.infer<typeof RedirectSchema>;
export type LinkKind = z.infer<typeof LinkKindSchema>;
