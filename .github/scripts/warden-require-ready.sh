#!/bin/sh
# Fail Warden on draft pull requests. Ruleset workflows never receive
# ready_for_review, so a passing run on a draft would let a PR that is later
# marked ready merge without review. This reads the live draft state, not the
# event payload, so re-running the check after marking the PR ready passes.
set -eu

: "${PR_URL:?PR_URL is required}"
: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY is required}"

is_draft=$(gh pr view "$PR_URL" --json isDraft --jq .isDraft)

case "$is_draft" in
  false)
    exit 0
    ;;
  true)
    message="Warden reviews this pull request once it is ready for review. Mark it ready, then re-run this check or push a commit."
    printf '::error::%s\n' "$message"
    printf '## Warden is waiting\n\n%s\n' "$message" >> "$GITHUB_STEP_SUMMARY"
    exit 1
    ;;
  *)
    printf '::error::Unexpected isDraft value from gh: %s\n' "$is_draft"
    exit 1
    ;;
esac
