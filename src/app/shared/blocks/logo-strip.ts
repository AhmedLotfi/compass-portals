import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';
import type { MediaRef } from '@schema/content';
import { CopyPipe } from '../../core/copy/copy';
import { MediaImage } from '../../core/media/media-image';
import { SmartLink } from '../smart-link/smart-link';

export interface LogoItem {
  media: string;
  href?: string;
}

/**
 * The old site's client strip: the logos drift sideways in a loop (a second, hidden copy of the
 * row follows the first), 5 seconds per logo plus 15. It runs only while in view and the tab is
 * shown, holds still under the pointer or keyboard focus, and under reduced motion it is a plain
 * row that scrolls sideways.
 */
@Component({
  selector: 'app-logo-strip',
  imports: [CopyPipe, MediaImage, SmartLink],
  template: `
    <div
      class="strip"
      [class.strip--running]="running()"
      tabindex="0"
      [attr.aria-label]="'logoStrip' | copy"
      (pointerenter)="hovered.set(true)"
      (pointerleave)="hovered.set(false)"
      (focusin)="focused.set(true)"
      (focusout)="focused.set(false)"
    >
      <div class="strip__track" [style.--strip-duration.s]="duration()">
        <div class="strip__group">
          @for (item of items(); track item.media) {
            @let image = media()[item.media];
            @if (image) {
              <div class="strip__cell">
                @if (item.href) {
                  <app-smart-link [href]="item.href" linkClass="strip__link">
                    <app-media-image [media]="image" sizes="9rem" />
                  </app-smart-link>
                } @else {
                  <app-media-image [media]="image" sizes="9rem" />
                }
              </div>
            }
          }
        </div>
        <div class="strip__group" aria-hidden="true" inert>
          @for (item of items(); track item.media) {
            @let image = media()[item.media];
            @if (image) {
              <div class="strip__cell"><app-media-image [media]="image" sizes="9rem" alt="" /></div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .strip {
      container-type: inline-size;
      overflow: hidden;
      border-block: var(--hairline);
      padding-block: 1.25rem;
    }
    .strip:focus-visible {
      outline-offset: -2px;
    }
    .strip__track {
      --strip-end: -50%;
      display: flex;
      inline-size: max-content;
      animation: strip-drift var(--strip-duration, 60s) linear infinite;
      animation-play-state: paused;
    }
    .strip__track:dir(rtl) {
      --strip-end: 50%;
    }
    .strip--running .strip__track {
      animation-play-state: running;
    }
    .strip__group {
      display: flex;
      align-items: center;
      justify-content: space-around;
      gap: 1.5rem;
      padding-inline-end: 1.5rem;
      min-inline-size: 100cqw;
      flex: none;
      box-sizing: border-box;
    }
    .strip__cell {
      display: grid;
      place-items: center;
      inline-size: 9rem;
      block-size: 4rem;
      flex: none;
    }
    .strip__cell img {
      inline-size: auto;
      max-inline-size: 100%;
      max-block-size: 4rem;
      object-fit: contain;
    }
    .strip__cell app-media-image {
      max-block-size: 100%;
    }
    .strip__link {
      display: block;
    }
    @keyframes strip-drift {
      to {
        translate: var(--strip-end) 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .strip {
        overflow-x: auto;
      }
      .strip__track {
        animation: none;
      }
    }
  `,
})
export class LogoStrip {
  readonly items = input.required<LogoItem[]>();
  readonly media = input.required<Record<string, MediaRef>>();

  protected readonly hovered = signal(false);
  protected readonly focused = signal(false);
  protected readonly visible = signal(false);
  protected readonly hidden = signal(false);
  /** The old site's pace: 5 s per logo, plus 15. */
  protected readonly duration = computed(() => this.items().length * 5 + 15);
  protected readonly running = computed(
    () =>
      this.items().length > 1 &&
      this.visible() &&
      !this.hidden() &&
      !this.hovered() &&
      !this.focused(),
  );

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      let observer: IntersectionObserver | undefined;
      if (typeof IntersectionObserver === 'undefined') this.visible.set(true);
      else {
        observer = new IntersectionObserver(([entry]) =>
          this.visible.set(entry?.isIntersecting ?? false),
        );
        observer.observe(host.nativeElement);
      }
      const onVisibility = () => this.hidden.set(document.hidden);
      onVisibility();
      document.addEventListener('visibilitychange', onVisibility);
      destroyRef.onDestroy(() => {
        observer?.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
      });
    });
  }
}
