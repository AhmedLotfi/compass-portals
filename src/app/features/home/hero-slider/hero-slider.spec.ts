import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { PageDoc } from '@schema/content';
import { HeroSlider } from './hero-slider';

const image = (id: string) => ({
  id,
  mime: 'image/png',
  width: 580,
  height: 460,
  alt: '',
  widths: [320, 480, 580],
  svg: false,
});

const page = {
  id: 'home',
  kind: 'home',
  path: '/',
  title: 'First slide',
  sourceUrl: 'https://example.org/',
  seo: {},
  hero: {
    title: 'First slide',
    lede: 'First lede',
    media: 'm-0000000001',
    ctas: [{ label: 'Talk to us', href: '/contact/', kind: 'internal' }],
    slides: [
      { title: 'First slide', lede: 'First lede', media: 'm-0000000001' },
      { title: 'Second slide', lede: 'Second lede', media: 'm-0000000002' },
      { title: 'Third slide', media: 'm-0000000003' },
    ],
  },
  sections: [],
  breadcrumbs: [],
  children: [],
  media: {
    'm-0000000001': image('m-0000000001'),
    'm-0000000002': image('m-0000000002'),
    'm-0000000003': image('m-0000000003'),
  },
} as unknown as PageDoc;

describe('Hero slider', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  async function render(doc: PageDoc = page) {
    const fixture = TestBed.createComponent(HeroSlider);
    fixture.componentRef.setInput('page', doc);
    await fixture.whenStable();
    return { fixture, root: fixture.nativeElement as HTMLElement };
  }

  it('prerenders every slide, with one H1, and shows the first', async () => {
    const { root } = await render();
    const text = (selector: string) =>
      [...root.querySelectorAll(selector)].map((el) => el.textContent!.trim());
    expect(text('h1')).toEqual(['First slide']);
    expect(text('.slide__title')).toEqual(['First slide', 'Second slide', 'Third slide']);
    expect(text('.slide__lede')).toEqual(['First lede', 'Second lede']);
    const slides = [...root.querySelectorAll<HTMLElement>('.slide')];
    expect(slides.map((s) => s.classList.contains('slide--active'))).toEqual([true, false, false]);
    expect(slides.map((s) => s.getAttribute('aria-hidden'))).toEqual(['false', 'true', 'true']);
    expect(slides.map((s) => s.hasAttribute('inert'))).toEqual([false, true, true]);
    // Only the current picture is in the layout (the others are not downloaded until shown).
    expect(root.querySelectorAll('.slider__picture').length).toBe(3);
    expect(root.querySelectorAll('.slider__picture--active').length).toBe(1);
    expect(root.querySelector('.slider__count')!.textContent!.trim()).toBe('1 / 3');
    expect(root.querySelectorAll('.slider__dot').length).toBe(3);
  });

  it('shows the slide a dot points at, and pauses on request', async () => {
    const { fixture, root } = await render();
    const dots = root.querySelectorAll<HTMLButtonElement>('.slider__dot');
    expect(dots[1]!.getAttribute('aria-label')).toBe('Show slide 2: Second slide');
    dots[1]!.click();
    await fixture.whenStable();
    const slides = [...root.querySelectorAll<HTMLElement>('.slide')];
    expect(slides.map((s) => s.classList.contains('slide--active'))).toEqual([false, true, false]);
    expect(dots[1]!.getAttribute('aria-current')).toBe('true');
    expect(root.querySelector('.slider__count')!.textContent!.trim()).toBe('2 / 3');

    const pause = root.querySelector<HTMLButtonElement>('.slider__pause')!;
    expect(pause.getAttribute('aria-pressed')).toBe('false');
    pause.click();
    await fixture.whenStable();
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    expect(pause.getAttribute('aria-label')).toBe('Play the slides');
  });

  it('shows the hero alone when the page has no carousel', async () => {
    const { root } = await render({
      ...page,
      hero: { ...page.hero, slides: undefined },
    } as PageDoc);
    expect(root.querySelectorAll('.slide').length).toBe(1);
    expect(root.querySelector('.slider__controls')).toBeNull();
  });
});
