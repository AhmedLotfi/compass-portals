import { Component, input } from '@angular/core';
import type { PageDoc } from '@schema/content';
import { Sections } from '../../shared/sections/sections';
import { ContactBand } from '../shared/contact-band';
import { HeroSlider } from './hero-slider/hero-slider';

@Component({
  selector: 'app-home',
  imports: [HeroSlider, Sections, ContactBand],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  readonly page = input.required<PageDoc>();
}
