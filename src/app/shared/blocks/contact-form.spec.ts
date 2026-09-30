import { TestBed } from '@angular/core/testing';
import contactJson from '@content/pages/contact-us.json';
import type { Block, PageDoc } from '@schema/content';
import { ContactAdapter, type ContactMessage } from '../../core/contact/contact-adapter';
import { ContactForm, slotFor } from './contact-form';

type FormBlock = Extract<Block, { type: 'contactForm' }>;
const contactPage = contactJson as unknown as PageDoc;
const formBlock = contactPage.sections
  .flatMap((s) => s.blocks)
  .find((b): b is FormBlock => b.type === 'contactForm')!;

describe('ContactForm', () => {
  const sent: ContactMessage[] = [];

  beforeEach(() => {
    sent.length = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ContactAdapter,
          useValue: { send: async (m: ContactMessage) => (sent.push(m), 'mail-app' as const) },
        },
      ],
    });
  });

  it('maps the site form fields to slots', () => {
    expect(formBlock.fields.map(slotFor)).toEqual(['name', 'email', 'message']);
    expect(slotFor({ name: 'your-phone', label: 'Mobile', kind: 'text', required: false })).toBe(
      'phone',
    );
    expect(slotFor({ name: 'org', label: 'Company', kind: 'text', required: false })).toBe(
      'company',
    );
  });

  it('renders the site labels and marks required fields', async () => {
    const fixture = TestBed.createComponent(ContactForm);
    fixture.componentRef.setInput('block', formBlock);
    await fixture.whenStable();
    const labels = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('.field__label'),
    ].map((l) => l.textContent!.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual(['Your name *', 'Your email *', 'Your message']);
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('button[type="submit"]')!
        .textContent!.trim(),
    ).toBe('Send');
  });

  it('shows errors instead of sending an invalid form, then sends with the site labels', async () => {
    const fixture = TestBed.createComponent(ContactForm);
    fixture.componentRef.setInput('block', formBlock);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const form = root.querySelector('form')!;

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(sent).toHaveLength(0);
    expect(root.querySelectorAll('.field__error').length).toBe(2);

    const type = (selector: string, value: string) => {
      const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    type('input[type="text"]:not([tabindex])', 'Ada');
    type('input[type="email"]', 'ada@example.org');
    type('textarea', 'Hello');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(sent).toEqual([
      {
        fields: [
          { label: 'Your name', value: 'Ada' },
          { label: 'Your email', value: 'ada@example.org' },
          { label: 'Your message', value: 'Hello' },
        ],
        replyTo: 'ada@example.org',
      },
    ]);
  });

  it('refuses to send when the honeypot is filled', async () => {
    const fixture = TestBed.createComponent(ContactForm);
    fixture.componentRef.setInput('block', formBlock);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    for (const [selector, value] of [
      ['input[type="text"]:not([tabindex])', 'Bot'],
      ['input[type="email"]', 'bot@example.org'],
      ['input[tabindex="-1"]', 'https://spam.example'],
    ] as const) {
      const input = root.querySelector<HTMLInputElement>(selector)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(sent).toHaveLength(0);
  });
});
