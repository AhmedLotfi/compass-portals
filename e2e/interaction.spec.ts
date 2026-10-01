import type { Block } from '../schema/content.ts';
import { copy, pageDoc, routes, site } from './content.ts';
import { expect, hydrated, test } from './fixtures.ts';

const inner = routes.find((route) => route.path !== '/')!;

test('the skip link moves focus to the main content without leaving the page', async ({ page }) => {
  await page.goto(inner.path);
  await hydrated(page);
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(inner.path);
});

test.describe('desktop menu', () => {
  const parent = site.navigation.header.find((item) => item.children.length);
  test.skip(({ isMobile }) => isMobile, 'The disclosure menu is the desktop navigation.');
  test.skip(!parent, 'The site menu has no sub-items.');

  test('opens and closes from the keyboard', async ({ page }) => {
    await page.goto('/');
    await hydrated(page);
    const toggle = page.locator('.nav-menu__toggle').first();
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('.nav-menu__panel');
    await expect(panel.getByRole('link', { name: parent!.children[0]!.label })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(panel).toHaveCount(0);
  });
});

test.describe('mobile menu', () => {
  test.skip(({ isMobile }) => !isMobile, 'The dialog menu is the mobile navigation.');

  test('opens as a modal dialog and gives focus back when closed', async ({ page }) => {
    await page.goto(inner.path);
    await hydrated(page);
    const button = page.getByRole('button', { name: copy['menu'], exact: true });
    await button.click();
    const dialog = page.locator('dialog#mobile-menu');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(
      dialog.getByRole('link', { name: site.navigation.header[0]!.label, exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open');
    await expect(button).toBeFocused();
  });

  test('closes when one of its links is followed', async ({ page }) => {
    const target = site.navigation.header.find(
      (item) => !item.external && item.href !== inner.path,
    );
    test.skip(!target, 'The menu has no other internal page.');
    await page.goto(inner.path);
    await hydrated(page);
    await page.getByRole('button', { name: copy['menu'], exact: true }).click();
    const dialog = page.locator('dialog#mobile-menu');
    await dialog.getByRole('link', { name: target!.label, exact: true }).click();
    await expect(page).toHaveURL(new URL(target!.href, page.url()).href);
    await expect(dialog).not.toHaveAttribute('open');
  });
});

test('with reduced motion, nothing animates on the home page', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', baseURL: baseURL! });
  const page = await context.newPage();
  await page.goto('/');
  await hydrated(page);
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .map((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        const what =
          (animation as CSSAnimation).animationName ||
          (animation as CSSTransition).transitionProperty ||
          animation.id;
        return `${what} on ${target ? `${target.tagName.toLowerCase()}.${target.className}` : '?'}`;
      }),
  );
  expect(running).toEqual([]);
  await context.close();
});

test.describe('contact form', () => {
  const route = routes.find((r) => r.kind === 'contact');
  const form = route
    ? pageDoc(route)
        .sections.flatMap((section) => section.blocks)
        .find(
          (block): block is Extract<Block, { type: 'contactForm' }> => block.type === 'contactForm',
        )
    : undefined;
  test.skip(!form, 'The site has no contact form.');

  test('flags missing fields, then hands the message to the email app', async ({ page }) => {
    await page.goto(route!.path);
    await hydrated(page);
    const submit = page.locator('form button[type="submit"]');
    await submit.click();
    const required = form!.fields.filter((field) => field.required);
    await expect(page.locator('.field__error')).toHaveCount(required.length);

    for (const field of required) {
      const input = page.getByLabel(field.label).first();
      if (field.kind === 'select') await input.selectOption({ index: 1 });
      else if (field.kind === 'email') await input.fill('ada@example.org');
      else if (field.kind === 'tel') await input.fill('+971 50 000 0000');
      else await input.fill('Ada Lovelace');
    }
    await submit.click();
    await expect(page.getByRole('status')).toHaveText(copy['formSentMail']!);
    await expect(page.locator('.field__error')).toHaveCount(0);
  });
});
