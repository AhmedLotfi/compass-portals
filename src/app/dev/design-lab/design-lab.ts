import { Component } from '@angular/core';
import { CompassHero } from '../../features/home/compass-hero/compass-hero';

interface Swatch {
  name: string;
  hex: string;
  use: string;
}

const SWATCHES: Swatch[] = [
  { name: 'paper', hex: '#f3f6f8', use: 'Background' },
  { name: 'paper-2', hex: '#e6edf2', use: 'Alternate bands' },
  { name: 'rule', hex: '#c5d2dc', use: 'Hairlines (decorative)' },
  { name: 'ink', hex: '#10263d', use: 'Text, primary' },
  { name: 'ink-2', hex: '#3b5064', use: 'Secondary text' },
  { name: 'brass', hex: '#a8823f', use: 'Graphics, large text' },
  { name: 'brass-deep', hex: '#7b5b21', use: 'Small accent text' },
  { name: 'signal', hex: '#b3261e', use: 'Form errors' },
];

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * Development-only review page for the design foundations (never part of the production build).
 * Specimen text here describes the specimens themselves; real copy only ever comes from the content sync.
 */
@Component({
  selector: 'app-design-lab',
  imports: [CompassHero],
  templateUrl: './design-lab.html',
  styleUrl: './design-lab.css',
})
export class DesignLab {
  protected readonly swatches = SWATCHES.map((s) => ({
    ...s,
    onPaper: contrast(s.hex, '#f3f6f8').toFixed(1),
  }));

  protected readonly scale = [
    {
      token: 'display',
      label: 'Display 44–72px, Source Serif 4 600',
      cls: 'text-display font-display',
    },
    { token: '3xl', label: 'Heading 1, 36–60px', cls: 'text-3xl font-display' },
    { token: '2xl', label: 'Heading 2, 28–36px', cls: 'text-2xl font-display' },
    { token: 'xl', label: 'Heading 3, 24px', cls: 'text-xl font-display' },
    { token: 'lg', label: 'Lede, 21px Hanken Grotesk', cls: 'text-lg' },
    { token: 'base', label: 'Body, 17px on a 1.6 line height', cls: 'text-base' },
    { token: 'sm', label: 'Small, 15px', cls: 'text-sm' },
    { token: 'xs', label: 'Caption, 13px', cls: 'text-xs' },
  ];
}
