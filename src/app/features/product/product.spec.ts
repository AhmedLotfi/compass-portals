import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import productJson from '@content/pages/products--charity-solutions--charity-management.json';
import type { PageDoc } from '@schema/content';
import { routes } from '../../app.routes';
import { linkKind } from '../../shared/smart-link/smart-link';
import { Product } from './product';

const product = productJson as unknown as PageDoc;

describe('Product page', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('renders the synced page: hero, breadcrumbs, rail sections and blocks', async () => {
    const fixture = TestBed.createComponent(Product);
    fixture.componentRef.setInput('page', product);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const text = (selector: string) =>
      [...root.querySelectorAll(selector)].map((el) => el.textContent!.replace(/\s+/g, ' ').trim());

    expect(text('h1')).toEqual(['Charity Management']);
    expect(text('.breadcrumbs li')).toEqual(['Home', 'Products', 'Charity Management & More']);
    expect(text('.rail-section__title')).toEqual([
      'Business Features',
      'Technical Features',
      'Charity Management Modules',
    ]);
    expect(text('.feature-list__text')).toEqual([
      'Feature one',
      'Feature two',
      'Web based',
      'SMS integration',
    ]);
    expect(text('.module-grid__name')).toEqual(['Sponsorship', 'Social Cases', 'Charity Projects']);
    expect(text('figcaption')).toEqual(['Module screen caption']);
    expect(text('#contact-band-title')).toEqual(['Ask about Charity Management & More']);
  });
});

describe('links and routes', () => {
  it('tells synced hrefs apart', () => {
    expect(linkKind('/products/')).toBe('internal');
    expect(linkKind('/files/brochure.pdf')).toBe('document');
    expect(linkKind('mailto:a@b.co')).toBe('email');
    expect(linkKind('tel:+97140000000')).toBe('phone');
    expect(linkKind('https://example.org/')).toBe('external');
  });

  it('has one static route per synced page, then 404 and the wildcard', () => {
    const paths = routes.filter((r) => r.path !== 'design-lab').map((r) => r.path);
    expect(paths).toEqual([
      '',
      'about-us',
      'contact-us',
      'products',
      'products/charity-solutions/charity-management',
      '404',
      '**',
    ]);
  });
});
