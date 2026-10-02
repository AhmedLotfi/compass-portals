import { Component, computed, input } from '@angular/core';
import { CATALOG_ICONS } from '@schema/icons';

/**
 * Hand-drawn 24px line icons (1.5px stroke), and the old front end's catalog icons for products,
 * services and industries (`@schema/icons`). Brand marks are in `BrandIcon` (footer only).
 */
export const LINE_PATHS = {
  ...CATALOG_ICONS,
  phone:
    'M6.7 3.6h2.4l1.4 4-1.9 1.3a11.4 11.4 0 0 0 6.5 6.5l1.3-1.9 4 1.4v2.4a2 2 0 0 1-2.2 2A16.4 16.4 0 0 1 4.7 5.8a2 2 0 0 1 2-2.2Z',
  mail: 'M3.5 6.5h17v11h-17Z M3.8 7 12 13.2 20.2 7',
  pin: 'M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z M12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  close: 'M6 6l12 12 M18 6 6 18',
  'chevron-down': 'M6 9.5l6 6 6-6',
  external:
    'M14 4.5h5.5V10 M19.5 4.5 11 13 M17 13.5v5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5',
  download: 'M12 4v11 M7.5 11 12 15.5 16.5 11 M5 19.5h14',
  check: 'M5 12.5 9.5 17 19 7.5',
  play: 'M8 5.5v13l10.5-6.5Z',
  pause: 'M8 5.5v13 M16 5.5v13',
  map: 'M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5Z M9 4.5v13 M15 6.5v13',
  linkedin:
    'M4.5 4.5h15v15h-15Z M8.2 10.6v5.4 M8.2 7.8v.1 M11.6 16v-5.4 M11.6 13.2a2.4 2.4 0 0 1 4.8 0V16',
} as const;

export type IconName = keyof typeof LINE_PATHS;

export function isIconName(name: string): name is IconName {
  return name in LINE_PATHS;
}

/** A decorative icon; the surrounding control provides the accessible name. */
@Component({
  selector: 'app-icon',
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  protected readonly path = computed(() => LINE_PATHS[this.name()]);
}
