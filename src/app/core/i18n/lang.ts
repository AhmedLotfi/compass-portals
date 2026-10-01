import { computed, Service, signal } from '@angular/core';
import type { Lang as LangCode } from '@schema/content';

export type { LangCode };

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN = /[A-Za-z]/;

/**
 * The language a text is written in, on a page in `pageLang`: on an Arabic page, text with Latin
 * letters and no Arabic ones is English (the CMS has no Arabic for it, so the English is shown).
 */
export function textLang(text: string | null | undefined, pageLang: LangCode): LangCode {
  if (pageLang === 'ar' && text && LATIN.test(text) && !ARABIC.test(text)) return 'en';
  return pageLang;
}

/** The same page in the other language's tree: `/products/` ⇄ `/ar/products/`. */
export function counterpart(path: string, lang: LangCode): string {
  const neutral = path === '/ar' || path.startsWith('/ar/') ? path.slice(3) || '/' : path;
  return lang === 'ar' ? `/ar${neutral}` : neutral;
}

export const DIRECTION: Record<LangCode, 'ltr' | 'rtl'> = { en: 'ltr', ar: 'rtl' };

/** The current page's language, set by the page resolver before each page renders. */
@Service()
export class Lang {
  readonly current = signal<LangCode>('en');
  readonly dir = computed(() => DIRECTION[this.current()]);
  /** The current page's path (undefined on the 404 page), for the language switch. */
  readonly path = signal<string | undefined>(undefined);
}
