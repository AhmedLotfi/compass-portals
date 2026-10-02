import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { MediaRef } from '@schema/content';
import { LogoStrip } from './logo-strip';

const logo = (n: number): [string, MediaRef] => [
  `m-000000000${n}`,
  {
    id: `m-000000000${n}`,
    mime: 'image/png',
    width: 140,
    height: 64,
    alt: 'Client logo',
    widths: [140],
    svg: false,
  },
];

describe('Logo strip', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('repeats the row once, hidden, and paces it at five seconds a logo plus fifteen', async () => {
    const media = Object.fromEntries([1, 2, 3, 4, 5, 6].map(logo));
    const fixture = TestBed.createComponent(LogoStrip);
    fixture.componentRef.setInput(
      'items',
      Object.keys(media).map((id) => ({ media: id })),
    );
    fixture.componentRef.setInput('media', media);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const groups = root.querySelectorAll('.strip__group');
    expect(groups.length).toBe(2);
    expect(groups[0]!.querySelectorAll('img').length).toBe(6);
    expect(groups[1]!.getAttribute('aria-hidden')).toBe('true');
    expect(groups[1]!.hasAttribute('inert')).toBe(true);
    expect((root.querySelector('.strip__track') as HTMLElement).style.getPropertyValue('--strip-duration')).toBe('45s');
    expect(root.querySelector('.strip')!.getAttribute('aria-label')).toBe('Client logos');
  });
});
