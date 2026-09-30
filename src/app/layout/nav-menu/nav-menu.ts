import { Component, ElementRef, inject, input, signal } from '@angular/core';
import type { NavItem } from '@schema/content';
import { Icon } from '../icon/icon';
import { NavLink } from '../nav-link/nav-link';

let nextId = 0;
const canHover = () => globalThis.matchMedia?.('(hover: hover)').matches ?? false;

/**
 * A top-level navigation item with a submenu (disclosure pattern): the label stays a link, a
 * separate toggle opens the panel. Opens on hover for mouse users; Escape and focus-out close it.
 */
@Component({
  selector: 'app-nav-menu',
  imports: [NavLink, Icon],
  templateUrl: './nav-menu.html',
  styleUrl: './nav-menu.css',
  host: {
    '(mouseenter)': 'hover(true)',
    '(mouseleave)': 'hover(false)',
    '(keydown.escape)': 'close(true)',
    '(focusout)': 'onFocusOut($event)',
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class NavMenu {
  readonly item = input.required<NavItem>();
  protected readonly open = signal(false);
  protected readonly panelId = `nav-menu-${nextId++}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected hover(entering: boolean): void {
    if (canHover()) this.open.set(entering);
  }

  close(restoreFocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus)
      this.host.nativeElement.querySelector<HTMLButtonElement>('.nav-menu__toggle')?.focus();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && !this.host.nativeElement.contains(next)) this.close();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.close();
  }
}
