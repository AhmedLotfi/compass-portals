/** subset-font 2.x ships no types: the part the media build uses. */
declare module 'subset-font' {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: { targetFormat?: 'woff2' | 'woff' | 'truetype' | 'sfnt' },
  ): Promise<Buffer>;
}
