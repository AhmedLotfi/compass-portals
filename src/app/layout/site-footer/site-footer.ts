import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentStore } from '../../core/content/content';
import { copy, CopyPipe, hasCopy } from '../../core/copy/copy';
import { MediaImage } from '../../core/media/media-image';
import { Icon, isIconName, type IconName } from '../icon/icon';
import { NavLink } from '../nav-link/nav-link';

/** Brand name of a social network the site links to (from the microcopy file). */
function networkName(network: string): string {
  const key = `network.${network}`;
  return hasCopy(key) ? copy(key) : network;
}

@Component({
  selector: 'app-site-footer',
  imports: [RouterLink, NavLink, MediaImage, Icon, CopyPipe],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.css',
})
export class SiteFooter {
  protected readonly content = inject(ContentStore);
  protected readonly site = this.content.site;
  protected readonly logo = this.content.logo;
  protected readonly logoWidth = this.logo
    ? `calc(2.4rem * ${(this.logo.width / this.logo.height).toFixed(4)})`
    : undefined;
  /** Footer menu from the site; the header's top level when the site has no footer menu. */
  protected readonly links = this.site.navigation.footer.length
    ? this.site.navigation.footer
    : this.site.navigation.header.map((item) => ({ ...item, children: [] }));
  protected readonly social = this.site.social.map((s) => ({
    ...s,
    name: networkName(s.network),
    icon: (isIconName(s.network) ? s.network : 'external') as IconName,
  }));
}
