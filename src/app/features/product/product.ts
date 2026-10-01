import { Component, computed, input } from '@angular/core';
import type { PageDoc } from '@schema/content';
import { copy } from '../../core/copy/copy';
import { Sections } from '../../shared/sections/sections';
import { ChildList } from '../shared/child-list';
import { ContactBand } from '../shared/contact-band';
import { PageHero } from '../shared/page-hero';

@Component({
  selector: 'app-product',
  imports: [PageHero, Sections, ChildList, ContactBand],
  template: `
    @let p = page();
    <app-page-hero [page]="p" />
    <div class="frame">
      <app-sections [sections]="p.sections" [media]="p.media" />
      @if (p.children.length) {
        <app-child-list [items]="p.children" [media]="p.media" [label]="p.title" />
      }
    </div>
    <app-contact-band [title]="askAbout()" />
  `,
})
export class Product {
  readonly page = input.required<PageDoc>();
  protected readonly askAbout = computed(() =>
    copy('askAbout', { title: this.page().title }, this.page().lang ?? 'en'),
  );
}
