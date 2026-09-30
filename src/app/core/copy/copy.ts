import { Pipe, type PipeTransform } from '@angular/core';
import microcopy from './microcopy.en.json';

/**
 * The only strings in the portal that don't come from compassint.org: short UI and CTA labels.
 * Keeping them in one reviewed file lets the provenance check tell them apart from site content.
 */
export type CopyKey = keyof typeof microcopy;

export function hasCopy(key: string): key is CopyKey {
  return Object.hasOwn(microcopy, key);
}

export function copy(key: CopyKey, params: Record<string, string> = {}): string {
  return microcopy[key].replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '');
}

/** `{{ 'contactUs' | copy }}` or `{{ 'askAbout' | copy: { title } }}` */
@Pipe({ name: 'copy' })
export class CopyPipe implements PipeTransform {
  transform(key: CopyKey, params?: Record<string, string>): string {
    return copy(key, params);
  }
}
