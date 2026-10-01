import { Component, computed, input } from '@angular/core';
import type { PageDoc } from '@schema/content';
import { AutoLang } from '../../core/i18n/auto-lang';
import { MediaImage } from '../../core/media/media-image';
import { Sections } from '../../shared/sections/sections';
import { SmartLink } from '../../shared/smart-link/smart-link';
import { ContactBand } from '../shared/contact-band';
import { CompassHero } from './compass-hero/compass-hero';

@Component({
  selector: 'app-home',
  imports: [AutoLang, CompassHero, Sections, ContactBand, SmartLink, MediaImage],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  readonly page = input.required<PageDoc>();
  protected readonly heroMedia = computed(() => {
    const p = this.page();
    return p.hero.media ? p.media[p.hero.media] : undefined;
  });
}
