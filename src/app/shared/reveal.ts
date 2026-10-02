import { afterNextRender, DestroyRef, Directive, ElementRef, inject, signal } from '@angular/core';

const mediaMatches = (query: string) => globalThis.matchMedia?.(query).matches ?? false;

/**
 * Reveals an element as it scrolls into view (a fade up, see `.reveal--*` in base.css). The
 * prerendered page shows everything; once the app runs, elements still below the fold wait,
 * hidden, until they near the viewport. Nothing waits under reduced motion. Children with the
 * `reveal-item` class follow one after another, in the order of their `--i` custom property.
 */
@Directive({
  selector: '[appReveal]',
  host: {
    '[class.reveal--pending]': 'pending()',
    '[class.reveal--in]': '!pending()',
  },
})
export class Reveal {
  protected readonly pending = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (mediaMatches('(prefers-reduced-motion: reduce)')) return;
      const el = host.nativeElement;
      if (el.getBoundingClientRect().top <= window.innerHeight) return;
      this.pending.set(true);
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          this.pending.set(false);
          observer.disconnect();
        },
        { rootMargin: '0px 0px -10% 0px' },
      );
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
