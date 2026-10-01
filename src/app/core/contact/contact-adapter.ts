import { Lang } from '../i18n/lang';
import { InjectionToken, inject, Service } from '@angular/core';
import { copy } from '../copy/copy';
import { ContentStore } from '../content/content';

/** Optional form endpoint (Formspree, Web3Forms, own API). Empty: the form opens the visitor's email app. */
export const CONTACT_ENDPOINT = new InjectionToken<string>('CONTACT_ENDPOINT', {
  providedIn: 'root',
  factory: () => '',
});

export interface ContactMessage {
  /** Each filled field with the label the site uses for it. */
  fields: { label: string; value: string }[];
  replyTo?: string;
}

export type ContactResult = 'sent' | 'mail-app';

@Service()
export class ContactAdapter {
  private readonly endpoint = inject(CONTACT_ENDPOINT);
  private readonly content = inject(ContentStore);
  private readonly lang = inject(Lang);

  /** The mailto: link for a message, addressed to the site's own email. */
  mailtoFor(message: ContactMessage): string | undefined {
    const to = this.content.primaryEmail;
    if (!to) return undefined;
    const body = message.fields.map((f) => `${f.label}: ${f.value}`).join('\n\n');
    const params = new URLSearchParams({
      subject: copy('mailSubject', {}, this.lang.current()),
      body,
    });
    return `mailto:${to}?${params.toString().replace(/\+/g, '%20')}`;
  }

  async send(message: ContactMessage): Promise<ContactResult> {
    if (this.endpoint) {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          ...Object.fromEntries(message.fields.map((f) => [f.label, f.value])),
          ...(message.replyTo ? { _replyto: message.replyTo } : {}),
        }),
      });
      if (!response.ok) throw new Error(`Contact endpoint answered ${response.status}`);
      return 'sent';
    }
    const mailto = this.mailtoFor(message);
    if (!mailto) throw new Error('The site has no contact email.');
    globalThis.location.href = mailto;
    return 'mail-app';
  }
}
