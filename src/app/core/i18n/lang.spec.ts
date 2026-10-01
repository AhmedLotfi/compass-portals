import { describe, expect, it } from 'vitest';
import ar from '../copy/microcopy.ar.json';
import en from '../copy/microcopy.en.json';
import { copy } from '../copy/copy';
import { counterpart, textLang } from './lang';

describe('languages', () => {
  it('has the same microcopy keys in English and Arabic, with the same placeholders', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(ar[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('fills microcopy in the requested language', () => {
    expect(copy('callNumber', { phone: '+971 4' })).toBe('Call +971 4');
    expect(copy('callNumber', { phone: '+971 4' }, 'ar')).toBe('اتصل بالرقم +971 4');
  });

  it('marks English text on Arabic pages only', () => {
    expect(textLang('HR & Payroll', 'ar')).toBe('en');
    expect(textLang('الموارد البشرية', 'ar')).toBe('ar');
    expect(textLang('إدارة ERP', 'ar')).toBe('ar');
    expect(textLang('+971 45754693', 'ar')).toBe('ar');
    expect(textLang('HR & Payroll', 'en')).toBe('en');
  });

  it('maps a page to the same page in the other tree', () => {
    expect(counterpart('/products/erp/', 'ar')).toBe('/ar/products/erp/');
    expect(counterpart('/ar/products/erp/', 'en')).toBe('/products/erp/');
    expect(counterpart('/', 'ar')).toBe('/ar/');
    expect(counterpart('/ar/', 'en')).toBe('/');
    expect(counterpart('/ar/', 'ar')).toBe('/ar/');
  });
});
