# Agent Instructions

## Repository
- Org-level GitHub metadata repository for Getsentry.
- Edit org profile content in `profile/README.md`.
- Edit GitHub configuration under `.github/`; root files cover shared policies and metadata.

## Package Manager
- No package manager, lockfile, or local build system is configured.

## File-Scoped Commands
| Task | Command |
|------|---------|
| YAML syntax | `ruby -e 'require "yaml"; ARGV.each { |f| YAML.load_file(f) }' .github/workflows/<file>.yml` |
| Whitespace | `git diff --check -- <path>` |

## GitHub Actions
- Org-wide Warden base config lives in `warden.toml`.
- Preserve existing third-party action pinning to full commit SHAs when editing workflows.
- Keep version comments beside pinned actions when present.
- `secret-scan.yml` reports to SIEM before failing detected secret scans; keep that flow intact.

## Security
- Follow `SECURITY.md` for vulnerability reporting text.
- Use inert placeholder values in examples; do not add realistic tokens or secrets.

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: (the agent's name and attribution byline)
```
