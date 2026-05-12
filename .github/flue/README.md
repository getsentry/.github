# Flue Automation

This directory holds shared Flue automation for Getsentry repositories.

## Issue Triage

Issue triage has three moving parts:

- `.github/workflows/issue-triage.yml`: reusable/manual GitHub Actions
  workflow.
- `.flue/agents/issue-triage.ts`: Flue CLI agent wrapper and deterministic
  GitHub mutations.
- `.agents/skills/issue-triage/SKILL.md`: model instructions for duplicate
  search, diagnosis, comment voice, and issue rewrite decisions.

GitHub Actions issue events run in the repository where the issue was opened, so
each enabled repository still needs this tiny caller workflow:

```yaml
name: Issue Triage

on:
  issues:
    types: [opened]

jobs:
  triage:
    permissions:
      contents: read
    uses: getsentry/.github/.github/workflows/issue-triage.yml@main
    with:
      issue-number: ${{ github.event.issue.number }}
      repository: ${{ github.repository }}
    secrets: inherit
```

The reusable workflow has an inline repository allowlist. For `workflow_call`
runs, the requested repository must belong to `getsentry` and match the caller
repository. Manual dispatch from `.github` can point at a different allowlisted
repository for smoke testing.

## Configuration

Required GitHub organization secrets:

- `FLUE_PRIVATE_KEY` secret for the Sentry Intern GitHub App.
- `FLUE_OPENAI_API_KEY` secret for the model provider.

Required GitHub organization variables:

- `FLUE_CLIENT_ID` variable for the Sentry Intern GitHub App.

Sentry Intern needs `Contents: read` and `Issues: read and write` repository
permissions. Source checkout uses the app's read token.

## Testing

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm exec flue build --target node
ruby -e 'require "yaml"; ARGV.each { |f| YAML.load_file(f) }' .github/workflows/issue-triage.yml
git diff --check -- .
```

The real smoke test is a manual workflow run against a disposable issue. This is
not a dry run: it can comment, label, or close the issue.

```bash
gh workflow run issue-triage.yml \
  --repo getsentry/.github \
  --ref main \
  -f repository=getsentry/sentry-mcp \
  -f issue-number=123
```

Inspect the run and issue afterward:

```bash
gh run list --repo getsentry/.github --workflow issue-triage.yml --limit 1
gh issue view 123 --repo getsentry/sentry-mcp --comments
```

For branch testing after the workflow has landed, dispatch from the branch and
pass the same branch as `automation-ref`:

```bash
gh workflow run issue-triage.yml \
  --repo getsentry/.github \
  --ref flue-issue-triage-bot-persona \
  -f automation-ref=flue-issue-triage-bot-persona \
  -f repository=getsentry/sentry-mcp \
  -f issue-number=123
```
