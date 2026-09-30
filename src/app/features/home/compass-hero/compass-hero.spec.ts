import { TestBed } from '@angular/core/testing';
import { CompassHero } from './compass-hero';
import { compassGeometry, polar, rosePoint, tickLines } from './compass-geometry';

describe('compass geometry', () => {
  it('measures bearings clockwise from north, with north up', () => {
    expect(polar(100, 0)).toEqual([0, -100]);
    expect(polar(100, 90)).toEqual([100, 0]);
    expect(polar(100, 180)).toEqual([0, 100]);
    expect(polar(100, 270)).toEqual([-100, 0]);
  });

  it('has 72 ticks in three tiers, ordered clockwise', () => {
    const ticks = tickLines(176);
    expect(ticks.map((t) => t.index)).toEqual([...Array(72).keys()]);
    expect(ticks.filter((t) => t.tier === 'major')).toHaveLength(12);
    expect(ticks.filter((t) => t.tier === 'medium')).toHaveLength(24);
    expect(ticks.filter((t) => t.tier === 'minor')).toHaveLength(36);
    expect(ticks[0]).toMatchObject({ tier: 'major', x1: 0, y1: -176, x2: 0, y2: -159 });
  });

  it('builds rose points from two triangles sharing the centre line', () => {
    const north = rosePoint(0, 134, 25);
    expect(north.dark.startsWith('M0 0L0 -134')).toBe(true);
    expect(north.light.startsWith('M0 0L0 -134')).toBe(true);
    expect(compassGeometry.rose).toHaveLength(16);
    expect(compassGeometry.letters.filter((l) => l.north).map((l) => l.label)).toEqual(['N']);
  });
});

describe('CompassHero', () => {
  it('renders a decorative compass', async () => {
    const fixture = TestBed.createComponent(CompassHero);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelectorAll('line.tick')).toHaveLength(72);
    expect(host.querySelectorAll('.rose__dark')).toHaveLength(16);
    expect(host.querySelector('.rose__letter--north')?.textContent?.trim()).toBe('N');
    expect((host.querySelector('line.tick') as SVGElement).style.getPropertyValue('--i')).toBe('0');
  });

  it('plays the intro once per tab, then shows the settled compass', async () => {
    const first = TestBed.createComponent(CompassHero);
    await first.whenStable();
    const second = TestBed.createComponent(CompassHero);
    await second.whenStable();
    expect((second.nativeElement as HTMLElement).classList.contains('settled')).toBe(true);
  });
});
