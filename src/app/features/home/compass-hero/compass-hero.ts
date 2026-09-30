import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Renderer2,
  RendererStyleFlags2,
} from '@angular/core';
import { compassGeometry } from './compass-geometry';

/** Set once the intro has played in this tab; later visits to the home page show a settled compass. */
let introPlayed = false;

const mediaMatches = (query: string) => globalThis.matchMedia?.(query).matches ?? false;

/** Decorative hero compass. Its intro is the site's single orchestrated motion moment. */
@Component({
  selector: 'app-compass-hero',
  templateUrl: './compass-hero.html',
  styleUrl: './compass-hero.css',
  host: {
    'aria-hidden': 'true',
    '[class.settled]': 'settled',
  },
})
export class CompassHero {
  protected readonly geometry = compassGeometry;
  protected readonly settled = introPlayed;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      introPlayed = true;
      if (!mediaMatches('(pointer: fine)') || mediaMatches('(prefers-reduced-motion: reduce)')) {
        return;
      }

      const el = this.host.nativeElement;
      let frame = 0;
      const onMove = (event: PointerEvent) => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const box = el.getBoundingClientRect();
          const bearing = Math.atan2(
            event.clientX - (box.left + box.width / 2),
            box.top + box.height / 2 - event.clientY,
          );
          const drift = `${(Math.sin(bearing) * 4).toFixed(2)}deg`;
          this.renderer.setStyle(el, '--drift', drift, RendererStyleFlags2.DashCase);
        });
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      destroyRef.onDestroy(() => {
        window.removeEventListener('pointermove', onMove);
        cancelAnimationFrame(frame);
      });
    });
  }
}
