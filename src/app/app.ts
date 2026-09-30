import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CopyPipe } from './core/copy/copy';
import { SiteFooter } from './layout/site-footer/site-footer';
import { SiteHeader } from './layout/site-header/site-header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeader, SiteFooter, CopyPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
