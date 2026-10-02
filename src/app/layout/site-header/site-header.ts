import { Component, computed, DestroyRef, type ElementRef, inject, viewChild } from '@angular/core';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { ContentStore } from '../../core/content/content';
import { CopyPipe } from '../../core/copy/copy';
import { counterpart, Lang } from '../../core/i18n/lang';
import { MediaImage } from '../../core/media/media-image';
import { Icon } from '../icon/icon';
import { NavLink } from '../nav-link/nav-link';
import { NavMenu } from '../nav-menu/nav-menu';

@Component({
  selector: 'app-site-header',
  imports: [RouterLink, NavLink, NavMenu, Icon, MediaImage, CopyPipe],
  templateUrl: './site-header.html',
  styleUrl: './site-header.css',
})
export class SiteHeader {
  protected readonly content = inject(ContentStore);
  protected readonly site = this.content.site;
  protected readonly logo = this.content.logo;
  /** The logo renders 3.5rem tall (the old header's size); its width follows its own aspect ratio. */
  protected readonly logoWidth = this.logo
    ? `calc(3.5rem * ${(this.logo.width / this.logo.height).toFixed(4)})`
    : undefined;
  protected readonly phone = this.content.primaryPhone;
  protected readonly email = this.content.primaryEmail;
  private readonly lang = inject(Lang);
  private readonly router = inject(Router);
  protected readonly homePath = computed(() => this.content.homePath(this.lang.current()));
  protected readonly header = computed(() => this.content.navigation(this.lang.current()).header);
  protected readonly contactPath = computed(() =>
    this.content.pathOf('contact', this.lang.current()),
  );
  /** The site's own menu entry for the contact page ("Get Started"): shown as the button. */
  protected readonly contactItem = computed(() =>
    this.header().find((item) => !item.external && item.href === this.contactPath()),
  );
  /** The desktop menu without that entry, which the button already shows. */
  protected readonly navItems = computed(() =>
    this.header().filter((item) => item !== this.contactItem()),
  );
  /** This page in the other language (every page exists in both trees). */
  protected readonly switchTo = computed(() => {
    const path = this.lang.path();
    if (!path) return undefined;
    const other = this.lang.current() === 'en' ? 'ar' : 'en';
    return { lang: other, path: counterpart(path, other) } as const;
  });
  protected readonly logoOnDark = this.site.logoTone === 'light';

  private readonly menu = viewChild.required<ElementRef<HTMLDialogElement>>('menu');

  constructor() {
    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) this.closeMenu();
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  protected openMenu(): void {
    this.menu().nativeElement.showModal();
  }

  protected closeMenu(): void {
    const dialog = this.menu().nativeElement;
    if (dialog.open) dialog.close();
  }

  /** Clicking the backdrop (outside the panel) closes the dialog. */
  protected onDialogClick(event: MouseEvent): void {
    if (event.target === this.menu().nativeElement) this.closeMenu();
  }
}
