import { Component, input } from '@angular/core';
import type { PageDoc } from '@schema/content';
import { Sections } from '../../shared/sections/sections';
import { ChildList } from '../shared/child-list';
import { ContactBand } from '../shared/contact-band';
import { PageHero } from '../shared/page-hero';

/** Generic pages (about, services, posts): the page's own sections in the margin-rail layout. */
@Component({
  selector: 'app-content-page',
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
export class ContentPage {
  readonly page = input.required<PageDoc>();
}
