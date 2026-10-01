import { describe, expect, it } from 'vitest';
import { pageIdentity, pageKey } from './render.ts';

describe('render crawl', () => {
  const origin = 'https://compassint.org';
  const hosts = ['compassint.org', 'www.compassint.org'];

  it('keys pages by path: one host form, no trailing slash, no plain fragments', () => {
    expect(pageKey('https://www.compassint.org/products/', origin, hosts)).toBe(
      'https://compassint.org/products',
    );
    expect(pageKey('https://compassint.org/about#team', origin, hosts)).toBe(
      'https://compassint.org/about',
    );
    expect(pageKey('https://compassint.org/', origin, hosts)).toBe('https://compassint.org/');
    expect(pageKey('https://compassint.org/list?page=2', origin, hosts)).toBe(
      'https://compassint.org/list?page=2',
    );
  });

  it('keeps hash routes, and ignores other sites and non-web links', () => {
    expect(pageKey('https://compassint.org/#/products', origin, hosts)).toBe(
      'https://compassint.org/#/products',
    );
    expect(pageKey('https://example.org/x', origin, hosts)).toBeUndefined();
    expect(pageKey('mailto:info@compassint.org', origin, hosts)).toBeUndefined();
    expect(pageKey('not a url', origin, hosts)).toBeUndefined();
  });

  it('treats URLs that differ only by the per-visit ciphertext as one page', () => {
    expect(
      pageIdentity(
        'https://compassint.org/solution/hr_&_payroll/U2FsdGVkX18bhGDj4BDDazsppFAGWDSov6RYukMBxqM%3D',
      ),
    ).toBe('https://compassint.org/solution/hr_&_payroll');
    expect(pageIdentity('https://compassint.org/about')).toBe('https://compassint.org/about');
  });
});
