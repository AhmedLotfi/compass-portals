import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentStore } from '../../core/content/content';
import { copy, CopyPipe } from '../../core/copy/copy';
import { Icon } from '../../layout/icon/icon';

/** The closing call to action on ink: the site's phone and email, and the contact page. */
@Component({
  selector: 'app-contact-band',
  imports: [RouterLink, Icon, CopyPipe],
  template: `
    <section class="contact-band" aria-labelledby="contact-band-title">
      <div class="contact-band__texture texture-contours-ink" aria-hidden="true"></div>
      <div class="frame contact-band__inner">
        <h2 id="contact-band-title" class="contact-band__title">{{ title() || defaultTitle }}</h2>
        <div class="contact-band__actions">
          @if (phone) {
            <a class="contact-band__link tnum" [href]="phone.tel"
              ><app-icon name="phone" />{{ phone.display }}</a
            >
          }
          @if (email) {
            <a class="contact-band__link" [href]="'mailto:' + email"
              ><app-icon name="mail" />{{ email }}</a
            >
          }
          @if (contactPath) {
            <a class="btn btn--on-ink" [routerLink]="contactPath">{{ 'contactUs' | copy }}</a>
          }
        </div>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }
    .contact-band {
      position: relative;
      background-color: var(--color-ink);
      color: var(--color-paper);
    }
    .contact-band__texture {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .contact-band__inner {
      position: relative;
      display: grid;
      gap: 1.75rem;
      padding-block: clamp(3rem, 2rem + 4vw, 5.5rem);
    }
    @media (min-width: 64rem) {
      .contact-band__inner {
        grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
        align-items: center;
      }
    }
    .contact-band__title {
      color: var(--color-paper);
      font-size: var(--text-2xl);
      max-inline-size: 18ch;
    }
    .contact-band__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem 1.75rem;
    }
    @media (min-width: 64rem) {
      .contact-band__actions {
        justify-content: flex-end;
      }
    }
    .contact-band__link {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      color: var(--color-paper);
      font-weight: 600;
      text-decoration-color: var(--color-brass);
    }
  `,
})
export class ContactBand {
  /** Optional heading, e.g. "Ask about {product}". */
  readonly title = input<string>();
  private readonly content = inject(ContentStore);
  protected readonly phone = this.content.primaryPhone;
  protected readonly email = this.content.primaryEmail;
  protected readonly contactPath = this.content.pathOf('contact');
  protected readonly defaultTitle = copy('talkToUs');
}
