/**
 * The catalog icons of the old front end (compassint.org's `app-catalog-icon`): a 24px stroke icon
 * chosen from the English title of a product, service or industry. The paths and the title rules
 * are the old front end's, verbatim; the app draws them and the content sync names them.
 */
export const CATALOG_ICONS = {
  people:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',
  chart: 'M3 21h18M5 17v-6h3v6M11 17V7h3v10M17 17V3h3v14',
  truck:
    'M1 4h13v13H1zM14 9h4l4 4v4h-8M7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0M21 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  building: 'M3 21V7l9-4v18M12 10h9v11M1 21h22M7 8v1M7 12v1M7 16v1M16 14h1M16 18h1',
  crane: 'M3 21V4h18M7 4v17M2 21h10M7 8l8-4M18 4v8M16 12h4v4h-4z',
  store:
    'M3 10v11h18V10M2 10l2-7h16l2 7M2 10a3.3 3.3 0 0 0 6.6 0 3.4 3.4 0 0 0 6.8 0 3.3 3.3 0 0 0 6.6 0M9 21v-7h6v7',
  graduation: 'm2 8 10-5 10 5-10 5L2 8M6 10v7c4 3 8 3 12 0v-7M22 8v8',
  columns: 'm2 7 10-5 10 5H2M4 10v8M9 10v8M15 10v8M20 10v8M2 21h20',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8',
  monitor: 'M3 3h18v13H3zM8 21h8M12 16v5m-4-14-3 3 3 3m8-6 3 3-3 3',
  document: 'M5 3h10l4 4v14H5V3M14 3v5h5M9 12h6M9 16h6',
} as const;

export type CatalogIcon = keyof typeof CATALOG_ICONS;

/** The old front end's rules, in its order; the last one is its fallback. */
const RULES: [RegExp, CatalogIcon][] = [
  [/hr|payroll|consulting/, 'people'],
  [/financ|insurance/, 'chart'],
  [/fleet|distribution/, 'truck'],
  [/property|real estate/, 'building'],
  [/project|construction/, 'crane'],
  [/retail/, 'store'],
  [/school|university/, 'graduation'],
  [/government|legal/, 'columns'],
  [/health/, 'cross'],
  [/charity|profit/, 'heart'],
  [/it service/, 'monitor'],
];

/** The icon the old front end shows for an English title. */
export function catalogIcon(titleEn: string): CatalogIcon {
  const title = titleEn.toLowerCase();
  return RULES.find(([pattern]) => pattern.test(title))?.[1] ?? 'document';
}

export function isCatalogIcon(name: string): name is CatalogIcon {
  return Object.hasOwn(CATALOG_ICONS, name);
}
