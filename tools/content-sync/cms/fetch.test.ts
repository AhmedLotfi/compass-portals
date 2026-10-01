import { describe, expect, it } from 'vitest';
import type { HttpResponse } from '../http.ts';
import { downloadImages, imageUrls, type ImageGetter } from './fetch.ts';

describe('CMS image fetch', () => {
  it('finds image URLs in fields and HTML, skipping the mobile variants', () => {
    const urls = imageUrls({
      imageUrl: 'https://cadmin.example/a.jpg',
      mobileImageUrl: 'http://ddns.example:2026/a-mobile.jpg',
      descriptionEn: '<p><img src="https://cadmin.example/b.png?x=1&amp;y=2"> text</p>',
      lines: [
        { imageUrl: 'https://cadmin.example//c.JPEG' },
        { logo: 'https://cadmin.example/doc.pdf' },
      ],
    });
    expect([...urls].sort()).toEqual([
      'https://cadmin.example//c.JPEG',
      'https://cadmin.example/a.jpg',
      'https://cadmin.example/b.png?x=1&y=2',
    ]);
  });

  it('tries HTTPS first, and stops calling an origin after its first network failure', async () => {
    const calls: string[] = [];
    const http: ImageGetter = {
      get: async (url: string) => {
        calls.push(url);
        if (url.includes('dead.example')) throw new Error('connect ETIMEDOUT');
        return {
          status: url.includes('missing') ? 404 : 200,
          headers: { 'content-type': 'image/png' },
        } as unknown as HttpResponse;
      },
    };
    const result = await downloadImages(
      [
        'http://dead.example:5002/1.png',
        'http://dead.example:5002/2.png',
        'https://ok.example/have.png',
        'https://ok.example/missing.png',
        'https://ok.example/new.png',
      ],
      (url) => url.endsWith('have.png'),
      http,
    );
    expect(calls).toEqual([
      'https://dead.example:5002/1.png',
      'http://dead.example:5002/1.png',
      'https://ok.example/missing.png',
      'https://ok.example/new.png',
    ]);
    expect(result.downloaded).toEqual(['https://ok.example/new.png']);
    // Both origins failed once for 1.png, so 2.png makes no requests at all.
    expect(result.missing.map((m) => [m.url, m.reason.split(' (')[0]])).toEqual([
      ['http://dead.example:5002/1.png', 'connect ETIMEDOUT'],
      ['http://dead.example:5002/2.png', 'host unreachable'],
      ['https://ok.example/missing.png', 'HTTP 404'],
    ]);
  });
});
