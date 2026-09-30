import { mediaLoader } from './media-loader';

describe('mediaLoader', () => {
  const widths = [320, 480, 640, 768, 960, 1200];

  it('maps a requested width to the smallest variant that covers it', () => {
    expect(mediaLoader({ src: 'm-0123456789', width: 500, loaderParams: { widths } })).toBe(
      '/media/m-0123456789-640.webp',
    );
    expect(mediaLoader({ src: 'm-0123456789', width: 320, loaderParams: { widths } })).toBe(
      '/media/m-0123456789-320.webp',
    );
  });

  it('never asks for more than the largest variant', () => {
    expect(mediaLoader({ src: 'm-0123456789', width: 3000, loaderParams: { widths } })).toBe(
      '/media/m-0123456789-1200.webp',
    );
    expect(mediaLoader({ src: 'm-0123456789', loaderParams: { widths } })).toBe(
      '/media/m-0123456789-1200.webp',
    );
  });

  it('serves SVGs as they are', () => {
    expect(mediaLoader({ src: 'm-0123456789', width: 640, loaderParams: { svg: true } })).toBe(
      '/media/m-0123456789.svg',
    );
  });
});
