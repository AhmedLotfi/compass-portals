import { AutoLang } from '../../core/i18n/auto-lang';
import { Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { Block, MediaRef } from '@schema/content';
import { CopyPipe } from '../../core/copy/copy';
import { MediaImage } from '../../core/media/media-image';
import { Icon } from '../../layout/icon/icon';
import { SmartLink } from '../smart-link/smart-link';
import { InternalLinks } from './internal-links';

/** A call-to-action link exactly as labelled on the site. */
@Component({
  selector: 'app-cta-block',
  imports: [SmartLink, Icon],
  template: `
    @let cta = block();
    <app-smart-link [href]="cta.href" linkClass="btn btn--outline">
      @if (cta.kind === 'document') {
        <app-icon name="download" />
      } @else if (cta.kind === 'phone') {
        <app-icon name="phone" />
      } @else if (cta.kind === 'email') {
        <app-icon name="mail" />
      }
      {{ cta.label }}
    </app-smart-link>
  `,
  host: { class: 'cta-block' },
})
export class CtaBlock {
  readonly block = input.required<Extract<Block, { type: 'cta' }>>();
}

/** Figures from the site (e.g. its counters), set large in the display serif. */
@Component({
  selector: 'app-stats-block',
  template: `
    <dl class="stats">
      @for (item of block().items; track $index) {
        <div class="stats__item">
          <dt class="stats__label">{{ item.label }}</dt>
          <dd class="stats__value tnum">{{ item.value }}</dd>
        </div>
      }
    </dl>
  `,
  styles: `
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr));
      gap: 1.5rem 2.5rem;
      margin: 0;
    }
    .stats__item {
      display: flex;
      flex-direction: column-reverse;
      gap: 0.35rem;
      padding-top: 1rem;
      border-top: 2px solid var(--color-brass);
    }
    .stats__value {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-3xl);
      line-height: 1;
      font-weight: 600;
      color: var(--color-ink);
    }
    .stats__label {
      color: var(--color-ink-2);
    }
  `,
})
export class StatsBlock {
  readonly block = input.required<Extract<Block, { type: 'stats' }>>();
}

@Component({
  selector: 'app-quote-block',
  imports: [AutoLang, InternalLinks, MediaImage],
  template: `
    @let quote = block();
    <figure class="quote">
      <blockquote class="prose-chart" appInternalLinks [innerHTML]="quote.html"></blockquote>
      @if (quote.cite) {
        <figcaption class="quote__by">
          @if (portrait(); as image) {
            <app-media-image class="quote__portrait" [media]="image" sizes="3.5rem" alt="" />
          }
          <span>
            <span class="quote__name" [appAutoLang]="quote.cite">{{ quote.cite }}</span>
            @for (line of quote.role; track $index) {
              <span class="quote__role" [appAutoLang]="line">{{ line }}</span>
            }
          </span>
        </figcaption>
      }
    </figure>
  `,
  styles: `
    .quote {
      margin: 0;
      padding-inline-start: 1.5rem;
      border-inline-start: 2px solid var(--color-brass);
    }
    blockquote {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--text-xl);
      line-height: var(--text-xl--line-height);
    }
    .quote__by {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      margin-top: 1.25rem;
      color: var(--color-ink-2);
      font-size: var(--text-sm);
    }
    .quote__portrait {
      inline-size: 3.5rem;
      flex: none;
      border-radius: 50%;
      overflow: hidden;
      border: var(--ink-line);
    }
    .quote__name,
    .quote__role {
      display: block;
    }
    .quote__name {
      color: var(--color-ink);
      font-weight: 600;
    }
  `,
})
export class QuoteBlock {
  readonly block = input.required<Extract<Block, { type: 'quote' }>>();
  readonly media = input<Record<string, MediaRef>>({});
  protected readonly portrait = computed(() => {
    const id = this.block().media;
    return id ? this.media()[id] : undefined;
  });
}

/** Questions and answers as native disclosure widgets: keyboard and screen-reader ready, no script. */
@Component({
  selector: 'app-faq-block',
  imports: [AutoLang, InternalLinks],
  template: `
    <div class="faq">
      @for (item of block().items; track $index) {
        <details class="faq__item">
          <summary class="faq__question" [appAutoLang]="item.question">{{ item.question }}</summary>
          <div class="faq__answer prose-chart" appInternalLinks [innerHTML]="item.html"></div>
        </details>
      }
    </div>
  `,
  styles: `
    .faq {
      border-block-start: var(--hairline);
    }
    .faq__item {
      border-block-end: var(--hairline);
    }
    .faq__question {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1rem;
      padding-block: 1rem;
      cursor: pointer;
      font-weight: 600;
      color: var(--color-ink);
      list-style: none;
    }
    .faq__question::-webkit-details-marker {
      display: none;
    }
    /* A compass-card tick that turns to point down when the answer is open. */
    .faq__question::after {
      content: '';
      flex: none;
      inline-size: 0.5rem;
      block-size: 0.5rem;
      border-inline-end: 2px solid var(--color-brass);
      border-block-end: 2px solid var(--color-brass);
      transform: rotate(-45deg);
      transition: transform 160ms var(--ease-out, ease-out);
    }
    .faq__item[open] > .faq__question::after {
      transform: rotate(45deg);
    }
    /* Right to left, the tick's borders sit on the other side: mirror its turn. */
    .faq__question:dir(rtl)::after {
      transform: rotate(45deg);
    }
    .faq__item[open] > .faq__question:dir(rtl)::after {
      transform: rotate(-45deg);
    }
    .faq__question:focus-visible {
      outline: 2px solid var(--color-ink);
      outline-offset: 2px;
    }
    .faq__answer {
      padding-block-end: 1.25rem;
      max-inline-size: 68ch;
    }
    @media (prefers-reduced-motion: reduce) {
      .faq__question::after {
        transition: none;
      }
    }
  `,
})
export class FaqBlock {
  readonly block = input.required<Extract<Block, { type: 'faq' }>>();
}

/** Click-to-load embed: no third-party requests until the visitor asks for the map or video. */
@Component({
  selector: 'app-embed-block',
  imports: [CopyPipe, Icon, SmartLink],
  template: `
    @let embed = block();
    @if (!embeddable()) {
      <p>
        <app-smart-link [href]="embed.url" linkClass="btn btn--outline">
          <app-icon name="external" />{{ embed.title || host() }}
        </app-smart-link>
      </p>
    } @else {
      <div class="embed" [class.embed--map]="embed.provider === 'map'">
        @if (loaded()) {
          <iframe
            [src]="safeUrl()"
            [title]="embed.title || host()"
            loading="lazy"
            allow="fullscreen; picture-in-picture"
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        } @else {
          <button type="button" class="btn btn--outline" (click)="loaded.set(true)">
            <app-icon [name]="embed.provider === 'map' ? 'map' : 'play'" />
            {{ (embed.provider === 'map' ? 'showMap' : 'playVideo') | copy }}
          </button>
          <p class="embed__notice">{{ 'embedNotice' | copy: { host: host() } }}</p>
        }
      </div>
    }
  `,
  styles: `
    .embed {
      display: grid;
      place-items: center;
      align-content: center;
      gap: 0.75rem;
      aspect-ratio: 16 / 9;
      border: var(--ink-line);
      background: var(--color-paper-2);
    }
    .embed--map {
      aspect-ratio: 4 / 3;
    }
    iframe {
      inline-size: 100%;
      block-size: 100%;
      border: 0;
    }
    .embed__notice {
      font-size: var(--text-xs);
      color: var(--color-ink-2);
    }
  `,
})
export class EmbedBlock {
  readonly block = input.required<Extract<Block, { type: 'embed' }>>();
  protected readonly loaded = signal(false);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly host = computed(() =>
    new URL(this.block().url).hostname.replace(/^www\./, ''),
  );
  /** Only HTTPS embeds from known providers become iframes; anything else is a plain link. */
  protected readonly embeddable = computed(
    () => this.block().provider !== 'other' && this.block().url.startsWith('https://'),
  );
  /** Trusted as a resource URL only for the known providers above (synced from the site's embed). */
  protected readonly safeUrl = computed<SafeResourceUrl>(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(
      this.embeddable() ? this.block().url : 'about:blank',
    ),
  );
}
