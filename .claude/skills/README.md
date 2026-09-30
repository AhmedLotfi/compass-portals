# Project skills

Skills vendored into this repo so every Claude Code session (local or cloud) gets them without extra setup.
Refresh them with `tools/vendor-skills.sh`.

| Skill | Source | Revision | Licence |
|---|---|---|---|
| `angular-developer` | [angular/skills](https://github.com/angular/skills), branch `22.2.x` | `7820c0c` (built from angular/angular `e9bf52a`) | MIT, © Google LLC (`LICENSE.txt`) |
| `angular-new-app` | [angular/skills](https://github.com/angular/skills), branch `22.2.x` | `7820c0c` | MIT, © Google LLC (`LICENSE.txt`) |
| `frontend-design` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official), `plugins/frontend-design` | `2a8ad9f` | Apache-2.0 (`LICENSE.txt`) |

The Angular skills track the Angular version in `package.json`. When Angular is upgraded, re-run the script
with the matching branch, e.g. `tools/vendor-skills.sh 22.3.x`.
