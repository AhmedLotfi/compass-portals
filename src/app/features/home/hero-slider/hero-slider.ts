import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
import type { HeroSlide, PageDoc } from '@schema/content';
import { CopyPipe } from '../../../core/copy/copy';
import { AutoLang } from '../../../core/i18n/auto-lang';
import { MediaImage } from '../../../core/media/media-image';
import { Icon } from '../../../layout/icon/icon';
import { SmartLink } from '../../../shared/smart-link/smart-link';
import { CompassHero } from '../compass-hero/compass-hero';

/** As on the old home page: the next slide after 8 s. */
export const SLIDE_INTERVAL_MS = 8_000;

/**
 * The home page's hero carousel, as the old site runs it: every slide prerendered, one shown at a
 * time, dots and a count to pick one, and the next slide every 8 seconds unless the visitor hovers
 * or focuses it, pauses it, looks away (hidden tab, scrolled past) or asks for reduced motion.
 * The site's compass settles on north behind the picture.
 */
@Component({
  selector: 'app-hero-slider',
  imports: [AutoLang, CompassHero, CopyPipe, Icon, MediaImage, SmartLink],
  templateUrl: './hero-slider.html',
  styleUrl: './hero-slider.css',
  host: {
    '(pointerenter)': 'hover(true)',
    '(pointerleave)': 'hover(false)',
    '(focusin)': 'focus(true)',
    '(focusout)': 'onFocusOut($event)',
    '(keydown)': 'onKeydown($event)',
  },
})
export class HeroSlider {
  readonly page = input.required<PageDoc>();

  /** The slides: the carousel's, or the hero alone when the page has no carousel. */
  protected readonly slides = computed<HeroSlide[]>(() => {
    const { hero } = this.page();
    return hero.slides?.length
      ? hero.slides
      : [
          {
            title: hero.title,
            ...(hero.lede ? { lede: hero.lede } : {}),
            ...(hero.media ? { media: hero.media } : {}),
          },
        ];
  });
  protected readonly index = signal(0);
  protected readonly count = computed(() => this.slides().length);
  /** Paused by the visitor (the pause button). */
  protected readonly paused = signal(false);
  protected readonly hovered = signal(false);
  protected readonly focused = signal(false);
  protected readonly settled = signal(false);
  /** Whether the slides advance on their own right now. */
  protected readonly playing = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = false;
  private reducedMotion = false;

  constructor() {
    afterNextRender(() => {
      const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.reducedMotion = motion?.matches ?? false;
      const onMotion = (event: MediaQueryListEvent) => {
        this.reducedMotion = event.matches;
        this.schedule();
      };
      motion?.addEventListener('change', onMotion);

      const onVisibility = () => this.schedule();
      document.addEventListener('visibilitychange', onVisibility);

      let observer: IntersectionObserver | undefined;
      if (typeof IntersectionObserver === 'undefined') {
        this.visible = true;
        this.schedule();
      } else {
        observer = new IntersectionObserver(([entry]) => {
          this.visible = entry?.isIntersecting ?? false;
          this.schedule();
        });
        observer.observe(this.host.nativeElement);
      }

      this.destroyRef.onDestroy(() => {
        clearTimeout(this.timer);
        observer?.disconnect();
        motion?.removeEventListener('change', onMotion);
        document.removeEventListener('visibilitychange', onVisibility);
      });
    });
  }

  protected media(id: string | undefined) {
    return id ? this.page().media[id] : undefined;
  }

  protected select(index: number): void {
    this.index.set((index + this.count()) % this.count());
    this.schedule();
  }

  protected togglePause(): void {
    this.paused.update((paused) => !paused);
    this.schedule();
  }

  protected hover(over: boolean): void {
    this.hovered.set(over);
    this.schedule();
  }

  protected focus(within: boolean): void {
    this.focused.set(within);
    this.schedule();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    this.focus(Boolean(next && this.host.nativeElement.contains(next)));
  }

  /** Arrow keys on the controls move between slides. */
  protected onKeydown(event: KeyboardEvent): void {
    if (!(event.target as HTMLElement).closest('.slider__dots')) return;
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const direction = this.host.nativeElement.closest('[dir="rtl"]') ? -step : step;
    this.select(this.index() + direction);
    const dots = this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.slider__dot');
    dots[this.index()]?.focus();
  }

  /** Arms the next advance, or stands down while anything asks the slides to hold still. */
  private schedule(): void {
    clearTimeout(this.timer);
    const playing =
      this.count() > 1 &&
      this.visible &&
      !this.reducedMotion &&
      !this.paused() &&
      !this.hovered() &&
      !this.focused() &&
      !(typeof document !== 'undefined' && document.hidden);
    this.playing.set(playing);
    if (!playing) return;
    this.timer = setTimeout(() => {
      this.index.update((i) => (i + 1) % this.count());
      this.schedule();
    }, SLIDE_INTERVAL_MS);
  }
}
