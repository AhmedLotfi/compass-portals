import { Component, computed, input } from '@angular/core';
import { BRAND_PATHS } from './brand-paths';
import { LINE_PATHS } from './icon';

type BrandName = keyof typeof BRAND_PATHS;

/**
 * A social network or app store mark (simple-icons), falling back to a line icon (e.g. the
 * hand-drawn LinkedIn mark) or the external-link icon. Only the footer uses it, so the brand paths
 * load with the footer's deferred chunk.
 */
@Component({
  selector: 'app-brand-icon',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" [class.brand]="brand()">
      <path [attr.d]="path()" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      inline-size: 1.25em;
      block-size: 1.25em;
      flex: none;
    }
    svg {
      inline-size: 100%;
      block-size: 100%;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    svg.brand {
      fill: currentColor;
      stroke: none;
    }
  `,
})
export class BrandIcon {
  readonly name = input.required<string>();
  protected readonly brand = computed(() => this.name() in BRAND_PATHS);
  protected readonly path = computed(() => {
    const name = this.name();
    if (name in BRAND_PATHS) return BRAND_PATHS[name as BrandName];
    return name in LINE_PATHS ? LINE_PATHS[name as keyof typeof LINE_PATHS] : LINE_PATHS.external;
  });
}
