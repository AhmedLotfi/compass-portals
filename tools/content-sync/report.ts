import type { NavItem } from './analyze.ts';
import type { Inventory } from './discover.ts';

/** Human-readable inventory: what exists on the site, and what needs a decision before designing pages. */
export function inventoryMarkdown(inv: Inventory): string {
  const lines: string[] = [];
  const p = inv.probe;
  const html = inv.pages.filter((page) => page.analysis);
  const ok = inv.pages.filter((page) => page.status === 200);
  const path = (url: string) => {
    try {
      const u = new URL(url);
      return decodeURIComponent(u.pathname + u.search);
    } catch {
      return url;
    }
  };
  const cell = (value: string | number | undefined) =>
    String(value ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\s+/g, ' ')
      .trim();

  lines.push(`# Content inventory: ${inv.origin}`, '');
  lines.push(`Generated ${inv.generatedAt}.`, '');
  lines.push('## Summary', '');
  lines.push(
    `- Pages found: **${inv.pages.length}** (${ok.length} return 200, ${html.length} analyzed as HTML)`,
  );
  if (inv.rest) {
    const counts = Object.entries(inv.rest.counts)
      .map(([type, count]) => `${type}: ${count < 0 ? `HTTP ${-count}` : count}`)
      .join(', ');
    lines.push(`- WordPress REST API: \`${p.rest?.base}\` (${counts})`);
  } else {
    lines.push(`- WordPress REST API: ${p.rest ? `\`${p.rest.base}\` (probe only)` : 'not found'}`);
  }
  lines.push(`- Images: **${inv.media.length}** unique; documents: **${inv.documents.length}**`);
  const languages = [...new Set(html.map((page) => page.analysis!.lang).filter(Boolean))];
  lines.push(`- Languages (\`<html lang>\`): ${languages.join(', ') || 'not declared'}`);
  if (p.platform.hreflang.length) {
    lines.push(
      `- hreflang alternates: ${p.platform.hreflang.map((h) => `${h.lang} → ${h.href}`).join(', ')}`,
    );
  }
  lines.push(`- Anomalies to review: **${inv.anomalies.length}**`, '');

  lines.push('## Platform', '');
  lines.push(
    `- Home: ${p.home.url} → HTTP ${p.home.status}${p.home.finalUrl !== p.home.url ? ` (final ${p.home.finalUrl})` : ''}`,
  );
  if (p.wwwHome) lines.push(`- www: HTTP ${p.wwwHome.status} → ${p.wwwHome.finalUrl}`);
  if (p.httpHome) lines.push(`- Plain HTTP: HTTP ${p.httpHome.status} → ${p.httpHome.finalUrl}`);
  lines.push(
    `- Server: ${p.home.headers['server'] ?? '?'}; powered by: ${p.home.headers['x-powered-by'] ?? '?'}; Cloudflare: ${p.cloudflare ? 'yes' : 'no'}`,
  );
  lines.push(`- Generator: ${p.platform.generator.join(', ') || '?'}`);
  lines.push(`- Theme: ${p.platform.theme ?? '?'}`);
  lines.push(`- Page builders and sliders: ${p.platform.builders.join(', ') || 'none detected'}`);
  lines.push(`- Plugins seen in markup: ${p.platform.plugins.join(', ') || 'none'}`);
  lines.push(`- Translation widgets: ${p.platform.translationWidgets.join(', ') || 'none'}`);
  lines.push(`- Cloudflare-obfuscated emails: ${p.platform.cfEmail ? 'yes (decoded)' : 'no'}`);
  lines.push(
    `- robots.txt: HTTP ${p.robots.status}; sitemaps listed: ${p.robots.sitemaps.join(', ') || 'none'}${p.robots.disallowsRest ? '; **disallows /wp-json/**' : ''}`,
  );
  if (p.rest) lines.push(`- REST namespaces: ${p.rest.namespaces.join(', ')}`);
  if (p.permalinks) {
    const pl = p.permalinks;
    lines.push(
      `- Permalinks (sample ${path(pl.sample)}): clean → ${pl.clean ? `${pl.clean.status} ${path(pl.clean.finalUrl)}` : 'n/a'}; /index.php → ${pl.indexPhp ? `${pl.indexPhp.status} ${path(pl.indexPhp.finalUrl)}` : 'n/a'}`,
    );
  }
  lines.push('');

  if (inv.sitemaps.length) {
    lines.push('## Sitemaps', '', '| URL | Status | Kind | Entries |', '|---|---|---|---|');
    for (const s of inv.sitemaps)
      lines.push(`| ${cell(s.url)} | ${s.status} | ${s.kind} | ${s.urls} |`);
    lines.push('');
  }

  lines.push('## Pages', '');
  lines.push(
    '| Path | Status | WordPress | Title | H1 | Words | Images | Forms | Also reached from | Sources |',
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const page of inv.pages) {
    const a = page.analysis;
    const wp = page.rest
      ? `${page.rest.type} #${page.rest.id}${page.rest.parent ? ` (parent ${page.rest.parent})` : ''}`
      : a?.wpId
        ? `${a.wpKind ?? '?'} #${a.wpId}`
        : (a?.wpKind ?? '');
    lines.push(
      `| ${cell(path(page.finalUrl))} | ${page.status} | ${cell(wp)} | ${cell(a?.title)} | ${cell(a?.h1.join(' / '))} | ${a?.wordCount ?? ''} | ${a?.images.length ?? ''} | ${cell(a?.forms.map((f) => f.kind).join(', '))} | ${cell([...page.aliases.map((u) => `${path(u)} (same page)`), ...page.requested.map((u) => `${path(u)} (redirect)`)].join(', '))} | ${page.sources.join(', ')} |`,
    );
  }
  lines.push('');

  lines.push('## Navigation', '');
  const renderMenu = (items: NavItem[], depth: number) => {
    for (const item of items) {
      lines.push(
        `${'  '.repeat(depth)}- ${item.label || '(no label)'}${item.href ? ` → ${path(item.href)}` : ''}`,
      );
      renderMenu(item.children, depth + 1);
    }
  };
  for (const [label, menus] of [
    ['Header', inv.menus.header],
    ['Footer', inv.menus.footer],
  ] as const) {
    lines.push(`### ${label} menus (${menus.length})`, '');
    menus.forEach((menu, i) => {
      lines.push(`Menu ${i + 1} (\`${menu.selector}\`):`, '');
      renderMenu(menu.items, 0);
      lines.push('');
    });
  }

  lines.push('## Media', '');
  const byHost = new Map<string, number>();
  for (const m of inv.media) byHost.set(m.host, (byHost.get(m.host) ?? 0) + 1);
  lines.push(
    `Hosts: ${[...byHost.entries()].map(([host, n]) => `${host} (${n})`).join(', ') || 'none'}`,
    '',
  );
  if (inv.pageStylesheets.length) {
    lines.push(
      `Per-page builder stylesheets (may hold background images): ${inv.pageStylesheets.length}`,
      '',
    );
  }
  if (inv.documents.length) {
    lines.push('### Documents', '');
    for (const d of inv.documents) lines.push(`- ${d.url} (on ${d.pages.map(path).join(', ')})`);
    lines.push('');
  }

  lines.push('## Contact details found', '');
  for (const [label, map] of [
    ['Emails', inv.contacts.emails],
    ['Phones', inv.contacts.phones],
  ] as const) {
    lines.push(`### ${label}`, '');
    const entries = Object.entries(map);
    if (!entries.length) lines.push('- none');
    for (const [value, onPages] of entries) {
      lines.push(
        `- \`${value}\` on ${onPages.length} page(s): ${onPages.slice(0, 5).map(path).join(', ')}${onPages.length > 5 ? ', …' : ''}`,
      );
    }
    lines.push('');
  }

  lines.push('## Anomalies (for review; nothing is fixed silently)', '');
  if (!inv.anomalies.length) lines.push('- none');
  const grouped = new Map<string, typeof inv.anomalies>();
  for (const anomaly of inv.anomalies) {
    grouped.set(anomaly.kind, [...(grouped.get(anomaly.kind) ?? []), anomaly]);
  }
  for (const [kind, list] of grouped) {
    lines.push(`### ${kind} (${list.length})`, '');
    for (const anomaly of list.slice(0, 50)) {
      lines.push(`- ${anomaly.detail} (${anomaly.pages.slice(0, 3).map(path).join(', ')})`);
    }
    if (list.length > 50) lines.push(`- … ${list.length - 50} more in inventory.json`);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}
