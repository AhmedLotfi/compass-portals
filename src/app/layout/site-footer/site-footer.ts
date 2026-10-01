import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentStore } from '../../core/content/content';
import { copy, CopyPipe, hasCopy } from '../../core/copy/copy';
import { Lang, type LangCode } from '../../core/i18n/lang';
import { AutoLang } from '../../core/i18n/auto-lang';
import { MediaImage } from '../../core/media/media-image';
import { BrandIcon } from '../icon/brand-icon';
import { Icon } from '../icon/icon';
import { NavLink } from '../nav-link/nav-link';

/** Brand name of a social network the site links to (from the microcopy file). */
function networkName(network: string, lang: LangCode): string {
  const key = `network.${network}`;
  return hasCopy(key) ? copy(key, {}, lang) : network;
}

@Component({
  selector: 'app-site-footer',
  imports: [RouterLink, NavLink, MediaImage, Icon, BrandIcon, CopyPipe, AutoLang],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.css',
})
export class SiteFooter {
  protected readonly content = inject(ContentStore);
  protected readonly site = this.content.site;
  protected readonly logo = this.content.logo;
  protected readonly logoOnDark = this.site.logoTone === 'light';
  protected readonly logoWidth = this.logo
    ? `calc(2.4rem * ${(this.logo.width / this.logo.height).toFixed(4)})`
    : undefined;
  private readonly lang = inject(Lang);
  private readonly navigation = computed(() => this.content.navigation(this.lang.current()));
  protected readonly homePath = computed(() => this.content.homePath(this.lang.current()));
  protected readonly tagline = computed(() => this.content.tagline(this.lang.current()));
  /** Footer menu groups (a heading link with its pages), as the site's footer columns. */
  protected readonly groups = computed(() =>
    this.navigation().footer.filter((item) => item.children.length),
  );
  /** Single footer links; the header's top level when the site has no footer menu. */
  protected readonly links = computed(() => {
    const { header, footer } = this.navigation();
    return footer.length
      ? footer.filter((item) => !item.children.length)
      : header.map((item) => ({ ...item, children: [] }));
  });
  protected readonly social = computed(() =>
    this.site.social.map((s) => ({ ...s, name: networkName(s.network, this.lang.current()) })),
  );
}
