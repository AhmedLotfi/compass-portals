import { AutoLang } from '../../core/i18n/auto-lang';
import { Component, input } from '@angular/core';
import type { MediaRef, Section } from '@schema/content';
import { BlockView } from '../blocks/block-view';
import { Reveal } from '../reveal';

/**
 * Page sections in the margin-rail layout: on wide screens the section title sits in the left rail,
 * like a note in a map margin; untitled sections keep the rail empty so everything stays aligned.
 * Each section fades up as it scrolls into view.
 */
@Component({
  selector: 'app-sections',
  imports: [AutoLang, BlockView, Reveal],
  template: `
    @for (section of sections(); track section.id) {
      <section
        class="rail-section"
        appReveal
        [id]="'s-' + section.id"
        [attr.aria-labelledby]="section.title ? 's-' + section.id + '-title' : null"
      >
        @if (section.title) {
          <h2
            class="rail-section__title"
            [id]="'s-' + section.id + '-title'"
            [appAutoLang]="section.title"
          >
            {{ section.title }}
          </h2>
        } @else {
          <div aria-hidden="true"></div>
        }
        <div class="rail-section__body">
          @for (block of section.blocks; track $index) {
            <app-block-view
              [block]="block"
              [media]="media()"
              [headingLevel]="section.title ? 3 : 2"
            />
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .rail-section__body {
      display: grid;
      gap: 2rem;
      min-inline-size: 0;
    }
  `,
})
export class Sections {
  readonly sections = input.required<Section[]>();
  readonly media = input.required<Record<string, MediaRef>>();
}
