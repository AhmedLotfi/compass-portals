import { Component, input } from '@angular/core';
import type { Block, MediaRef } from '@schema/content';
import { ContactForm } from './contact-form';
import { FeatureList } from './feature-list';
import { MediaBlock } from './media-block';
import { ModuleGrid } from './module-grid';
import { RichText } from './rich-text';
import { CtaBlock, EmbedBlock, FaqBlock, QuoteBlock, StatsBlock } from './small-blocks';

/** Renders one content block by type. */
@Component({
  selector: 'app-block-view',
  imports: [
    RichText,
    FeatureList,
    ModuleGrid,
    MediaBlock,
    CtaBlock,
    StatsBlock,
    QuoteBlock,
    FaqBlock,
    EmbedBlock,
    ContactForm,
  ],
  template: `
    @let b = block();
    @switch (b.type) {
      @case ('richText') {
        <app-rich-text [block]="b" />
      }
      @case ('featureList') {
        <app-feature-list [block]="b" />
      }
      @case ('moduleGrid') {
        <app-module-grid [block]="b" [media]="media()" [level]="headingLevel()" />
      }
      @case ('media') {
        <app-media-block [block]="b" [media]="media()" />
      }
      @case ('gallery') {
        <app-media-block [block]="b" [media]="media()" />
      }
      @case ('cta') {
        <app-cta-block [block]="b" />
      }
      @case ('stats') {
        <app-stats-block [block]="b" />
      }
      @case ('quote') {
        <app-quote-block [block]="b" [media]="media()" />
      }
      @case ('faq') {
        <app-faq-block [block]="b" />
      }
      @case ('embed') {
        <app-embed-block [block]="b" />
      }
      @case ('contactForm') {
        <!-- Prerendered, but the form code (Signal Forms) only loads when it nears the viewport. -->
        @defer (on immediate; hydrate on viewport) {
          <app-contact-form [block]="b" />
        }
      }
    }
  `,
  host: { style: 'display: block' },
})
export class BlockView {
  readonly block = input.required<Block>();
  readonly media = input.required<Record<string, MediaRef>>();
  /** Level for the block's own headings: 2 when its section has no title (h2) of its own. */
  readonly headingLevel = input<2 | 3>(3);
}
