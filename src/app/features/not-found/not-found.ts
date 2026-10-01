import { Lang } from '../../core/i18n/lang';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentStore } from '../../core/content/content';
import { CopyPipe } from '../../core/copy/copy';
import { NavLink } from '../../layout/nav-link/nav-link';
import { CompassHero } from '../home/compass-hero/compass-hero';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, NavLink, CompassHero, CopyPipe],
  template: `
    <section class="frame not-found" aria-labelledby="not-found-title">
      <div class="not-found__copy">
        <h1 id="not-found-title">{{ 'notFoundTitle' | copy }}</h1>
        <p class="not-found__body">{{ 'notFoundBody' | copy }}</p>
        <a class="btn btn--ink" [routerLink]="home()">{{ 'notFoundHome' | copy }}</a>
        @if (links().length) {
          <ul class="not-found__links">
            @for (item of links(); track item.href + item.label) {
              <li><app-nav-link [item]="item" linkClass="footer-link" /></li>
            }
          </ul>
        }
      </div>
      <app-compass-hero class="not-found__compass" />
    </section>
  `,
  styles: `
    .not-found {
      display: grid;
      gap: 2.5rem;
      align-items: center;
      padding-block: clamp(3rem, 2rem + 6vw, 7rem);
    }
    @media (min-width: 60rem) {
      .not-found {
        grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
      }
    }
    .not-found__copy {
      display: grid;
      gap: 1.25rem;
      justify-items: start;
    }
    .not-found__body {
      max-inline-size: 46ch;
      font-size: var(--text-lg);
      color: var(--color-ink-2);
    }
    .not-found__links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.25rem;
      list-style: none;
      margin: 0.5rem 0 0;
      padding: 0;
    }
    .not-found__compass {
      justify-self: center;
      inline-size: min(100%, 22rem);
    }
  `,
})
export class NotFound {
  private readonly content = inject(ContentStore);
  private readonly lang = inject(Lang);
  protected readonly home = computed(() => this.content.homePath(this.lang.current()));
  protected readonly links = computed(() =>
    this.content.navigation(this.lang.current()).header.map((item) => ({ ...item, children: [] })),
  );
}
