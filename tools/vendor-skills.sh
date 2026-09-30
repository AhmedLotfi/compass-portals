#!/usr/bin/env bash
# Refreshes the vendored Claude Code skills in .claude/skills/.
# Usage: tools/vendor-skills.sh [angular-skills-branch]   (default: 22.2.x)
set -euo pipefail

branch="${1:-22.2.x}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skills="$root/.claude/skills"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git clone -q --depth 1 --branch "$branch" https://github.com/angular/skills "$work/ng-skills"
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/anthropics/claude-plugins-official "$work/cpo"
git -C "$work/cpo" sparse-checkout set plugins/frontend-design >/dev/null
curl -fsS "https://raw.githubusercontent.com/angular/angular/$branch/LICENSE" -o "$work/angular-LICENSE"

for name in angular-developer angular-new-app; do
  rm -rf "${skills:?}/$name"
  cp -r "$work/ng-skills/$name" "$skills/$name"
  cp "$work/angular-LICENSE" "$skills/$name/LICENSE.txt"
done

rm -rf "${skills:?}/frontend-design"
mkdir -p "$skills/frontend-design"
cp "$work/cpo/plugins/frontend-design/skills/frontend-design/"{SKILL.md,LICENSE.txt} "$skills/frontend-design/"

echo "angular/skills@$branch: $(git -C "$work/ng-skills" rev-parse --short HEAD)"
echo "claude-plugins-official@main: $(git -C "$work/cpo" rev-parse --short HEAD)"
echo "Update the revision column in .claude/skills/README.md."
