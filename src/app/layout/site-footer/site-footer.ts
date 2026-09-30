import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentStore } from '../../core/content/content';
import { CopyPipe } from '../../core/copy/copy';
import { MediaImage } from '../../core/media/media-image';
import { Icon, isIconName, type IconName } from '../icon/icon';
import { NavLink } from '../nav-link/nav-link';

/** Brand names of the social networks the site links to (proper nouns, not copy). */
const NETWORK_NAMES: Record<string, string> = {
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
};

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
    name: NETWORK_NAMES[s.network] ?? s.network,
    icon: (isIconName(s.network) ? s.network : 'external') as IconName,
  }));
}
