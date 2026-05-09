# Flue Automation

This directory holds org-level Flue automation configuration.

## Issue Triage

Issue triage is implemented by:

- `.github/workflows/issue-triage.yml`: reusable/manual GitHub Actions workflow.
- `.flue/agents/issue-triage.ts`: Flue CLI agent wrapper and deterministic
  GitHub mutations.
- `.agents/skills/issue-triage/SKILL.md`: model instructions for duplicate
  search, diagnosis, comment voice, and issue rewrite decisions.
- `.github/flue/features.json`: central feature allowlist by repository.

GitHub does not subscribe reusable workflows to repository events by itself.
Each target repository needs a small caller workflow:

```yaml
name: Issue Triage

on:
  issues:
    types: [opened]

jobs:
  triage:
    uses: getsentry/.github/.github/workflows/issue-triage.yml@main
    permissions:
      contents: read
    with:
      issue-number: ${{ github.event.issue.number }}
      repository: ${{ github.repository }}
    secrets: inherit
```

Repositories are still centrally gated by `features.json`. If a caller workflow
is added to a repository that is not listed there, the reusable workflow exits
before creating a Sentry Intern app token or checking out the target repository.

## Configuration

Required organization configuration:

- `FLUE_CLIENT_ID` variable for the Sentry Intern GitHub App.
- `FLUE_PRIVATE_KEY` secret for the Sentry Intern GitHub App.
- `FLUE_OPENAI_API_KEY` secret for the model provider.

Sentry Intern only needs the GitHub App `Issues: read and write` repository
permission for triage comments, labels, issue edits, and issue closure. Source
checkout uses the caller workflow's `GITHUB_TOKEN` with `contents: read`.

## Testing

Local validation catches packaging and syntax problems before a PR lands:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm exec flue build --target node
ruby -e 'require "yaml"; ARGV.each { |f| YAML.load_file(f) }' .github/workflows/issue-triage.yml
node .github/scripts/check-flue-feature.mjs .github/flue/features.json issue-triage getsentry/sentry-mcp
git diff --check -- .
```

The real smoke test is a manual workflow run against a specific disposable
issue. This is not a dry run: it uses the Sentry Intern app token and may
comment, edit, label, or close the issue.

```bash
gh workflow run issue-triage.yml \
  --repo getsentry/.github \
  --ref main \
  -f repository=getsentry/sentry-mcp \
  -f issue-number=123
```

Then inspect the run and issue:

```bash
gh run list --repo getsentry/.github --workflow issue-triage.yml --limit 1
gh issue view 123 --repo getsentry/sentry-mcp --comments
```

For the first landing, the workflow file must be merged to the default branch
before `workflow_dispatch` can run. For later changes, dispatch the workflow
from the branch under test and pass the same branch as `automation-ref` so the
checkout uses the branch's Flue code:

```bash
gh workflow run issue-triage.yml \
  --repo getsentry/.github \
  --ref flue-issue-triage-bot-persona \
  -f automation-ref=flue-issue-triage-bot-persona \
  -f repository=getsentry/sentry-mcp \
  -f issue-number=123
```
