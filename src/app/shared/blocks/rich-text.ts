import { Component, input } from '@angular/core';
import type { Block } from '@schema/content';
import { InternalLinks } from './internal-links';

/** Rich text synced from the site (sanitized at sync time), styled by the global `.prose-chart`. */
@Component({
  selector: 'app-rich-text',
  imports: [InternalLinks],
  template: `<div class="prose-chart" appInternalLinks [innerHTML]="block().html"></div>`,
})
export class RichText {
  readonly block = input.required<Extract<Block, { type: 'richText' }>>();
}
