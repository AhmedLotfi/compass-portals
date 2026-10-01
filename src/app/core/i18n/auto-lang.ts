import { computed, Directive, inject, input } from '@angular/core';
import { DIRECTION, Lang, textLang } from './lang';

/**
 * Marks a text that isn't in the page's language: on an Arabic page, a CMS value with no Arabic
 * (the site shows the English) gets `lang="en" dir="ltr"`, so screen readers pronounce it as
 * English and it reads left to right. `<h3 [appAutoLang]="item.title">{{ item.title }}</h3>`
 */
@Directive({
  selector: '[appAutoLang]',
  host: {
    '[attr.lang]': 'mark()',
    '[attr.dir]': 'mark() ? direction() : null',
  },
})
export class AutoLang {
  readonly appAutoLang = input<string | null | undefined>();
  private readonly lang = inject(Lang);
  private readonly textLang = computed(() => textLang(this.appAutoLang(), this.lang.current()));
  protected readonly mark = computed(() =>
    this.textLang() === this.lang.current() ? null : this.textLang(),
  );
  protected readonly direction = computed(() => DIRECTION[this.textLang()]);
}
