/**
 * Design lint: fails on the generic "templated page" tells the design rules ban (see CLAUDE.md).
 *
 *   node tools/verify/design-tells.ts [dir ...]     (default: src)
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../content-sync/config.ts';

export interface Finding {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

interface Rule {
  id: string;
  message: string;
  files: RegExp;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    id: 'no-uppercase-labels',
    message: 'All-caps labels are banned; use sentence case.',
    files: /\.(css|html|ts)$/,
    pattern: /text-transform:\s*uppercase|(?:class|\[class\])="[^"]*\buppercase\b/,
  },
  {
    id: 'no-arrow-links',
    message: 'Do not append arrows to link or button text.',
    files: /\.(html|ts)$/,
    pattern: /→|&rarr;|&#8594;/,
  },
  {
    id: 'no-middot-meta',
    message: 'Do not join metadata with spaced middle dots.',
    files: /\.(html|ts)$/,
    pattern: / · |&middot;/,
  },
  {
    id: 'no-grey-card-shadow',
    message: 'The generic grey card shadow is banned; the only shadow is --shadow-panel.',
    files: /\.css$/,
    pattern:
      /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.1\s*\)|rgb\(\s*0\s+0\s+0\s*\/\s*(?:0?\.1|10%)\s*\)/,
  },
  {
    id: 'no-cream-terracotta',
    message: 'Cream and terracotta are off-palette; use the True North tokens.',
    files: /\.(css|html|ts)$/,
    pattern: /#(?:f4f1ea|faf7f2|f5f0e8|efe9df|d97757|c96442|cc785c)\b/i,
  },
  {
    id: 'no-numbered-markers',
    message: 'Numbered 01/02 markers are only for real sequences; mark sequences with <ol>.',
    files: /\.html$/,
    pattern: />\s*0[1-9]\s*</,
  },
];

const SKIP = /(^|\/)(node_modules|dist|\.angular)(\/|$)|\/styles\/(fonts|easing)\.css$/;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (SKIP.test(full)) continue;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

export function lintSource(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split('\n');
  for (const rule of RULES) {
    if (!rule.files.test(file)) continue;
    lines.forEach((text, i) => {
      if (rule.pattern.test(text)) {
        findings.push({
          file,
          line: i + 1,
          rule: `${rule.id}: ${rule.message}`,
          excerpt: text.trim(),
        });
      }
    });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dirs = process.argv.slice(2);
  const findings: Finding[] = [];
  for (const dir of dirs.length ? dirs : ['src']) {
    for await (const file of walk(path.resolve(ROOT, dir))) {
      findings.push(...lintSource(path.relative(ROOT, file), await readFile(file, 'utf8')));
    }
  }
  for (const f of findings) console.error(`${f.file}:${f.line}  ${f.rule}\n    ${f.excerpt}`);
  console.error(
    findings.length ? `\n${findings.length} design tell(s) found.` : 'No design tells found.',
  );
  process.exitCode = findings.length ? 1 : 0;
}
