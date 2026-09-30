import { Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import type { Block } from '@schema/content';
import { CopyPipe } from '../../core/copy/copy';
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
  imports: [InternalLinks],
  template: `
    <figure class="quote">
      <blockquote class="prose-chart" appInternalLinks [innerHTML]="block().html"></blockquote>
      @if (block().cite) {
        <figcaption>{{ block().cite }}</figcaption>
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
    figcaption {
      margin-top: 0.75rem;
      color: var(--color-ink-2);
      font-size: var(--text-sm);
    }
  `,
})
export class QuoteBlock {
  readonly block = input.required<Extract<Block, { type: 'quote' }>>();
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
