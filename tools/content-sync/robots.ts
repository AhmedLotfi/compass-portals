/** Minimal robots.txt support: groups, Allow/Disallow with `*` and `$`, longest match wins, Allow wins ties. */

export interface RobotsRules {
  sitemaps: string[];
  isAllowed(pathWithQuery: string): boolean;
}

interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

export function parseRobots(text: string, userAgent: string): RobotsRules {
  const token = userAgent.split('/')[0]!.toLowerCase();
  const sitemaps: string[] = [];
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | undefined;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (field !== 'allow' && field !== 'disallow')) continue;
    if (field === 'disallow' && value === '') continue; // "Disallow:" allows everything
    current.rules.push({ allow: field === 'allow', pattern: value, regex: patternToRegex(value) });
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);

  return {
    sitemaps,
    isAllowed(pathWithQuery: string): boolean {
      let best: Rule | undefined;
      for (const rule of rules) {
        if (!rule.regex.test(pathWithQuery)) continue;
        if (
          !best ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow)
        ) {
          best = rule;
        }
      }
      return best ? best.allow : true;
    },
  };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}
