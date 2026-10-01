import { AutoLang } from '../../core/i18n/auto-lang';
import { Component, computed, inject, input } from '@angular/core';
import type { PageDoc } from '@schema/content';
import { ContentStore } from '../../core/content/content';
import { CopyPipe } from '../../core/copy/copy';
import { Icon } from '../../layout/icon/icon';
import { Sections } from '../../shared/sections/sections';
import { PageHero } from '../shared/page-hero';

/**
 * The contact page: the site's contact details first (unless the page lists its own offices), then
 * its own content, including its form.
 */
@Component({
  selector: 'app-contact',
  imports: [AutoLang, PageHero, Sections, Icon, CopyPipe],
  template: `
    @let p = page();
    <app-page-hero [page]="p" />
    <div class="frame">
      @if (!ownLocations()) {
        <section class="rail-section" aria-labelledby="contact-details-title">
          <h2 class="rail-section__title" id="contact-details-title">
            {{ 'contactDetails' | copy }}
          </h2>
          <dl class="details">
            @if (contact.address.length) {
              <div class="details__row">
                <dt><app-icon name="pin" />{{ 'address' | copy }}</dt>
                <dd>
                  <address>
                    @for (line of contact.address; track line) {
                      <span class="details__line" [appAutoLang]="line">{{ line }}</span>
                    }
                  </address>
                  @if (contact.mapUrl) {
                    <a [href]="contact.mapUrl" target="_blank" rel="noopener">
                      {{ 'openMap' | copy
                      }}<span class="visually-hidden"> {{ 'opensInNewTab' | copy }}</span>
                    </a>
                  }
                </dd>
              </div>
            }
            @if (contact.phones.length) {
              <div class="details__row">
                <dt><app-icon name="phone" />{{ 'phone' | copy }}</dt>
                <dd>
                  @for (phone of contact.phones; track phone.tel) {
                    <a class="details__line tnum" [href]="phone.tel">{{ phone.display }}</a>
                  }
                </dd>
              </div>
            }
            @if (contact.emails.length) {
              <div class="details__row">
                <dt><app-icon name="mail" />{{ 'email' | copy }}</dt>
                <dd>
                  @for (email of contact.emails; track email) {
                    <a class="details__line" [href]="'mailto:' + email">{{ email }}</a>
                  }
                </dd>
              </div>
            }
          </dl>
        </section>
      }
      <app-sections [sections]="p.sections" [media]="p.media" />
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .details {
      display: grid;
      gap: 1.25rem;
      margin: 0;
    }
    .details__row {
      display: grid;
      gap: 0.4rem;
      padding-top: 1.1rem;
      border-top: var(--hairline);
    }
    @media (min-width: 48rem) {
      .details__row {
        grid-template-columns: 11rem minmax(0, 1fr);
      }
    }
    dt {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--color-ink-2);
      font-weight: 600;
      font-size: var(--text-sm);
    }
    dd {
      margin: 0;
      display: grid;
      gap: 0.35rem;
    }
    address {
      font-style: normal;
    }
    .details__line {
      display: block;
    }
  `,
})
export class Contact {
  readonly page = input.required<PageDoc>();
  protected readonly contact = inject(ContentStore).site.contact;
  /** The site lists its offices on the contact page itself: then that list is the details. */
  protected readonly ownLocations = computed(() =>
    this.page().sections.some((section) => section.id === 'locations'),
  );
}
