/**
 * The compassint.org content API (ASP.NET Boilerplate, `webapi.compassint.org/api/services/app/*`),
 * read from the HTTP archive. The live site's Angular front end loads every page from it, so these
 * responses are the site's content as published: no scraping of builder markup needed.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveEntry } from '../http.ts';
import type { AssetManifest } from '../fetch.ts';

export const API_HOST = 'webapi.compassint.org';
const API_BASE = `https://${API_HOST}/api/services/app/`;

/** Every bilingual record carries an English and an Arabic value. */
export interface Bilingual {
  titleEn: string | null;
  titleAr: string | null;
}

export interface LandingLine extends Bilingual {
  id: number;
  isActive: boolean;
  order: number;
  descriptionEn: string | null;
  descriptionAr: string | null;
  imageUrl: string | null;
  mobileImageUrl: string | null;
}

export interface LandingFeature extends Bilingual {
  id: number;
  isActive: boolean;
  order: number;
  descriptionEn: string | null;
  descriptionAr: string | null;
  logo: string | null;
}

export interface PageDetail extends Bilingual {
  id: number;
  webPageId: number;
  isActive: boolean;
  order: number;
  descriptionEn: string | null;
  descriptionAr: string | null;
  logo: string | null;
  imageUrl: string | null;
  mobileImageUrl: string | null;
  videoTitle: string | null;
  videoUrl: string | null;
  showlines: boolean;
  showFeatures: boolean;
  webPageLandingLines: LandingLine[];
  webPageLandingFeatures: LandingFeature[];
  lastModificationTime: string | null;
  creationTime: string;
}

export interface WebPage extends Bilingual {
  id: number;
  isActive: boolean;
  order: number;
  descriptionEn: string | null;
  descriptionAr: string | null;
  imageUrl: string | null;
  webPageDetails: PageDetail[];
  lastModificationTime: string | null;
  creationTime: string;
}

export interface Slide extends Bilingual {
  id: number;
  isActive: boolean;
  order: number;
  detailsEn: string | null;
  detailsAr: string | null;
  imageImagePath: string | null;
  mobileImagePath: string | null;
  clientName?: string | null;
  descriptions?: string | null;
  otherURL?: string | null;
}

export interface Slogan {
  id: number;
  isActive: boolean;
  titleEn: string | null;
  titleAr: string | null;
  contentEn: string | null;
  contentAr: string | null;
  copyRightEn: string | null;
  copyRightAr: string | null;
}

export interface SloganLine extends Bilingual {
  id: number;
  isActive: boolean;
  descriptionEn: string | null;
  descriptionAr: string | null;
  messageEn: string | null;
  messageAr: string | null;
  imageUrl: string | null;
}

export interface Faq {
  id: number;
  isActive: boolean;
  order: number;
  questionEn: string | null;
  questionAr: string | null;
  answerEn: string | null;
  answerAr: string | null;
}

export interface Feedback {
  id: number;
  isActive: boolean;
  order: number;
  nameEn: string | null;
  nameAr: string | null;
  positionNameEn: string | null;
  positionNameAr: string | null;
  companyNameEn: string | null;
  companyNameAr: string | null;
  messageEn: string | null;
  messageAr: string | null;
  imageUrl: string | null;
}

export interface Office {
  id: number;
  isActive: boolean;
  orderNumber: string | null;
  countryName: string | null;
  countryFlag: string | null;
  address: string | null;
  phoneNumber: string | null;
  mobileNumber: string | null;
  whatsappNumber: string | null;
  email: string | null;
  mapUrl: string | null;
}

export interface TeamMember {
  id: number;
  isActive: boolean;
  orderNumber: string | null;
  nameEN: string | null;
  nameAR: string | null;
  jobEN: string | null;
  jobAR: string | null;
  descriptionEN: string | null;
  descriptionAR: string | null;
  imageUrl: string | null;
}

export interface CmsContent {
  /** Sections (About, Products, Services, Features, Industries), each with its pages. */
  pages: WebPage[];
  slides: Slide[];
  slogans: Slogan[];
  sloganLines: SloganLine[];
  faqs: Faq[];
  feedback: Feedback[];
  offices: Office[];
  team: TeamMember[];
  partners: Slide[];
  clients: Slide[];
  /** When each endpoint was archived (newest), for the snapshot's provenance. */
  fetchedAt: string;
}

/** The archived HTTP manifest, indexed by URL. */
export class Archive {
  readonly dir: string;
  private readonly byUrl: Map<string, ArchiveEntry>;

  private constructor(dir: string, byUrl: Map<string, ArchiveEntry>) {
    this.dir = dir;
    this.byUrl = byUrl;
  }

  static async open(dir: string): Promise<Archive> {
    const entries = JSON.parse(
      await readFile(path.join(dir, 'manifest.json'), 'utf8'),
    ) as ArchiveEntry[];
    return new Archive(dir, new Map(entries.map((entry) => [entry.url, entry])));
  }

  get(url: string): ArchiveEntry | undefined {
    return this.byUrl.get(url);
  }

  get entries(): ArchiveEntry[] {
    return [...this.byUrl.values()];
  }

  hasApi(): boolean {
    return this.entries.some((entry) => entry.url.startsWith(API_BASE) && entry.status === 200);
  }

  async json<T>(url: string): Promise<{ data: T; fetchedAt: string }> {
    const entry = this.byUrl.get(url);
    if (!entry?.file || entry.status !== 200)
      throw new Error(`The archive has no successful response for ${url}`);
    const body = JSON.parse(await readFile(path.join(this.dir, entry.file), 'utf8')) as {
      result: T;
      success?: boolean;
    };
    if (body.success === false) throw new Error(`${url} answered with an error`);
    return { data: body.result, fetchedAt: entry.fetchedAt };
  }

  /**
   * Every archived image as a downloaded asset, so the media registry can use the files the
   * browser loaded. The CMS writes some URLs with a doubled slash (`//ERPAttachments/…`); both
   * spellings resolve to the same file.
   */
  imageAssets(): AssetManifest {
    const assets: AssetManifest['assets'] = [];
    const resolved: Record<string, string> = {};
    for (const entry of this.entries) {
      const type = entry.headers['content-type']?.split(';')[0]?.trim() ?? '';
      if (entry.status !== 200 || !entry.file || !entry.sha256 || !type.startsWith('image/'))
        continue;
      assets.push({
        url: entry.url,
        kind: 'image',
        status: 200,
        file: entry.file,
        sha256: entry.sha256,
        contentType: type,
        bytes: entry.bytes,
      });
      resolved[entry.url] = entry.url;
      resolved[collapseSlashes(entry.url)] ??= entry.url;
    }
    return { generatedAt: '', assets, resolved, missing: [] };
  }
}

/** `https://host//a//b` → `https://host/a/b` (the path only). */
export function collapseSlashes(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
  return parsed.href;
}

const list = <T>(result: T[] | { items: T[] }): T[] =>
  Array.isArray(result) ? result : result.items;

/** Reads every endpoint the site's front end calls. */
export async function loadCms(archive: Archive): Promise<CmsContent> {
  const times: string[] = [];
  const get = async <T>(endpoint: string): Promise<T> => {
    const { data, fetchedAt } = await archive.json<T>(API_BASE + endpoint);
    times.push(fetchedAt);
    return data;
  };
  const content: CmsContent = {
    pages: await get<WebPage[]>('WebPages/GetAllWebPageDetailsLinesForWebsite'),
    slides: list(await get<Slide[] | { items: Slide[] }>('PrSliderSettings/GetAll')),
    slogans: await get<Slogan[]>('Slogan/GetAllSlogans'),
    sloganLines: await get<SloganLine[]>('WebSloganLines/GetAllWebSloganLinesForWebsite'),
    faqs: await get<Faq[]>('WebFaq/GetAllWebFaqForWebsite'),
    feedback: await get<Feedback[]>('WebFeedback/GetAllWebFeedbackForWebsite'),
    offices: await get<Office[]>('WebOfficeLocation/GetAllWebOfficeLocationForWebsite'),
    team: await get<TeamMember[]>('WebOurTeam/GetAllWebOurTeamForWebsite'),
    partners: await get<Slide[]>('APartnersLogo/GetAllSliders'),
    clients: await get<Slide[]>('OurClientLogo/GetAllSliders'),
    fetchedAt: '',
  };
  content.fetchedAt = times.sort().at(-1) ?? '';
  return content;
}

/** Active records in the site's order (ties by id, so the output is stable). */
export function ordered<T extends { isActive: boolean; id: number }>(
  items: readonly T[],
  order: (item: T) => number = (item) => Number((item as { order?: number | null }).order ?? 0),
): T[] {
  // Records without an order sort last, as the old front end shows them.
  const rank = (item: T) => order(item) || Number.MAX_SAFE_INTEGER;
  return items.filter((item) => item.isActive).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
}
