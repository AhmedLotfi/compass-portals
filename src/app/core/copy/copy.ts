import { inject, Pipe, type PipeTransform } from '@angular/core';
import { Lang, type LangCode } from '../i18n/lang';
import ar from './microcopy.ar.json';
import en from './microcopy.en.json';

/**
 * The only strings in the portal that don't come from compassint.org: short UI and CTA labels.
 * Keeping them in one reviewed file per language lets the provenance check tell them apart from
 * site content. The Arabic file is a hand-written draft (the old site has no Arabic interface
 * text); both files have the same keys (unit-tested).
 */
export type CopyKey = keyof typeof en;

const MICROCOPY: Record<LangCode, Record<CopyKey, string>> = { en, ar };

export function hasCopy(key: string): key is CopyKey {
  return Object.hasOwn(en, key);
}

export function copy(
  key: CopyKey,
  params: Record<string, string> = {},
  lang: LangCode = 'en',
): string {
  return MICROCOPY[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
}

/**
 * `{{ 'contactUs' | copy }}` or `{{ 'askAbout' | copy: { title } }}`, in the current page's
 * language. Impure, so a label follows the language when the layout stays and the page changes.
 */
@Pipe({ name: 'copy', pure: false })
export class CopyPipe implements PipeTransform {
  private readonly lang = inject(Lang);

  transform(key: CopyKey, params?: Record<string, string>, lang?: LangCode): string {
    return copy(key, params, lang ?? this.lang.current());
  }
}
