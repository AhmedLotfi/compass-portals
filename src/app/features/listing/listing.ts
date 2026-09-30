import { Component, input } from '@angular/core';
import type { PageDoc } from '@schema/content';
import { Sections } from '../../shared/sections/sections';
import { ChildList } from '../shared/child-list';
import { ContactBand } from '../shared/contact-band';
import { PageHero } from '../shared/page-hero';

/** Index and category pages (products, services): their own content, then their child pages. */
@Component({
  selector: 'app-listing',
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
    <app-contact-band />
  `,
})
export class Listing {
  readonly page = input.required<PageDoc>();
}
