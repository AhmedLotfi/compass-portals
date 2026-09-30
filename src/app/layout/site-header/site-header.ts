import { Component, DestroyRef, type ElementRef, inject, viewChild } from '@angular/core';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { ContentStore } from '../../core/content/content';
import { CopyPipe } from '../../core/copy/copy';
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
  /** The logo renders 2.6rem tall; its width follows its own aspect ratio. */
  protected readonly logoWidth = this.logo
    ? `calc(2.6rem * ${(this.logo.width / this.logo.height).toFixed(4)})`
    : undefined;
  protected readonly phone = this.content.primaryPhone;
  protected readonly email = this.content.primaryEmail;
  protected readonly contactPath = this.content.pathOf('contact');

  private readonly menu = viewChild.required<ElementRef<HTMLDialogElement>>('menu');

  constructor() {
    const subscription = inject(Router).events.subscribe((event) => {
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
