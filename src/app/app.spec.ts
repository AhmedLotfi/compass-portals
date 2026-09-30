import { LocationStrategy, TrailingSlashPathLocationStrategy } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';

@Component({ template: '' })
class Blank {}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: 'about-us', component: Blank },
          { path: '404', component: Blank },
        ]),
        { provide: LocationStrategy, useClass: TrailingSlashPathLocationStrategy },
      ],
    }).compileComponents();
  });

  it('links the skip link to the main landmark of the current page and focuses it', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/about-us');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const skip = root.querySelector<HTMLAnchorElement>('a.skip-link')!;
    const main = root.querySelector<HTMLElement>('main#main')!;
    // A bare "#main" would resolve against <base href="/"> and leave the page.
    expect(skip.getAttribute('href')).toBe('/about-us/#main');

    document.body.append(root);
    skip.click();
    expect(document.activeElement).toBe(main);
    root.remove();
  });

  it('points the 404 page at the file it is served from', async () => {
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/404');
    await fixture.whenStable();
    const skip = (fixture.nativeElement as HTMLElement).querySelector('a.skip-link')!;
    expect(skip.getAttribute('href')).toBe('/404.html#main');
  });
});
