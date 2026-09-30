import { describe, expect, it } from 'vitest';
import { lintSource } from './design-tells.ts';

const rules = (file: string, source: string) =>
  lintSource(file, source).map((f) => f.rule.split(':')[0]);

describe('design lint', () => {
  it('flags the banned tells', () => {
    expect(rules('a.css', '.eyebrow { text-transform: uppercase; }')).toEqual([
      'no-uppercase-labels',
    ]);
    expect(rules('a.html', '<p class="text-xs uppercase tracking-widest">x</p>')).toEqual([
      'no-uppercase-labels',
    ]);
    expect(rules('a.html', '<a href="/x">Learn more →</a>')).toEqual(['no-arrow-links']);
    expect(rules('a.html', '<p>ERP · Oracle · 2003</p>')).toEqual(['no-middot-meta']);
    expect(rules('a.css', '.card { box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }')).toEqual([
      'no-grey-card-shadow',
    ]);
    expect(rules('a.css', ':root { --bg: #F4F1EA; }')).toEqual(['no-cream-terracotta']);
    expect(rules('a.html', '<span class="num">01</span>')).toEqual(['no-numbered-markers']);
  });

  it('allows the True North patterns', () => {
    expect(rules('a.css', '.btn { box-shadow: var(--shadow-panel); color: #10263d; }')).toEqual([]);
    expect(rules('a.html', '<a class="btn btn--ink" href="/contact/">Contact us</a>')).toEqual([]);
    expect(rules('a.html', '<ol><li>Step</li></ol>')).toEqual([]);
  });
});
