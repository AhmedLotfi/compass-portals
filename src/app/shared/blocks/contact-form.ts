import { Lang } from '../../core/i18n/lang';
import { Component, computed, inject, input, signal } from '@angular/core';
import {
  email,
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import type { Block } from '@schema/content';
import { ContactAdapter } from '../../core/contact/contact-adapter';
import { copy, CopyPipe } from '../../core/copy/copy';

type ContactFormBlock = Extract<Block, { type: 'contactForm' }>;
type SiteField = ContactFormBlock['fields'][number];

/** The fields the portal's form can collect; the site's own form decides which appear. */
export type Slot = 'name' | 'email' | 'phone' | 'company' | 'subject' | 'message';

export function slotFor(field: SiteField): Slot | undefined {
  if (field.kind === 'email') return 'email';
  if (field.kind === 'tel') return 'phone';
  if (field.kind === 'textarea') return 'message';
  const key = `${field.name} ${field.label}`.toLowerCase();
  if (/phone|mobile|tel\b/.test(key)) return 'phone';
  if (/company|organi[sz]ation/.test(key)) return 'company';
  if (/subject|topic/.test(key)) return 'subject';
  if (/name/.test(key)) return 'name';
  return undefined;
}

const AUTOCOMPLETE: Record<Slot, string> = {
  name: 'name',
  email: 'email',
  phone: 'tel',
  company: 'organization',
  subject: 'off',
  message: 'off',
};

let nextId = 0;

@Component({
  selector: 'app-contact-form',
  imports: [FormField, CopyPipe],
  templateUrl: './contact-form.html',
  styleUrl: './contact-form.css',
})
export class ContactForm {
  readonly block = input.required<ContactFormBlock>();

  private readonly adapter = inject(ContactAdapter);
  protected readonly id = `contact-${nextId++}`;
  protected readonly autocomplete = AUTOCOMPLETE;

  /** The site's fields that map to a slot, in the site's order, with its labels. */
  protected readonly fields = computed(() => {
    const seen = new Set<Slot>();
    return this.block()
      .fields.map((field) => ({ field, slot: slotFor(field) }))
      .filter((f): f is { field: SiteField; slot: Slot } => {
        if (!f.slot || seen.has(f.slot)) return false;
        seen.add(f.slot);
        return true;
      });
  });

  private isRequired(slot: Slot): boolean {
    return this.fields().some((f) => f.slot === slot && f.field.required);
  }

  protected readonly model = signal({
    name: '',
    email: '',
    phone: '',
    company: '',
    subject: '',
    message: '',
    /** Honeypot: people never see it; bots fill it in. */
    website: '',
  });

  private readonly lang = inject(Lang);

  protected readonly contact = form(this.model, (path) => {
    for (const slot of ['name', 'email', 'phone', 'company', 'subject', 'message'] as const) {
      required(path[slot], {
        when: () => this.isRequired(slot),
        message: copy('formRequired', {}, this.lang.current()),
      });
    }
    email(path.email, { message: copy('formEmail', {}, this.lang.current()) });
    maxLength(path.message, 5000);
    validate(path.website, ({ value }) => (value() ? { kind: 'spam' } : undefined));
  });

  protected readonly status = signal<'idle' | 'sending' | 'sent' | 'mail-app' | 'failed'>('idle');

  protected fieldId(slot: Slot): string {
    return `${this.id}-${slot}`;
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    void submit(this.contact, async () => {
      this.status.set('sending');
      const values = this.model();
      try {
        const result = await this.adapter.send({
          fields: this.fields()
            .filter(({ slot }) => values[slot].trim())
            .map(({ field, slot }) => ({ label: field.label, value: values[slot].trim() })),
          ...(values.email ? { replyTo: values.email } : {}),
        });
        this.status.set(result);
      } catch {
        this.status.set('failed');
      }
    });
  }
}
