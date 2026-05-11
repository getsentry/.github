import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FlueSession } from "@flue/sdk/client";

import {
  buildDuplicateClosureComment,
  buildDuplicateCloseArgs,
  buildNotPlannedCloseArgs,
  hasCloseReason,
  hasDuplicateReason,
  hasDuplicateOfFlag,
  hasNotPlannedReason,
  hasIssueTriageBotIntro,
  issueRepositoryFromIssue,
  issueRepositoryFromUrl,
  prepareRepository,
  wasClosedAsNotPlanned,
  withIssueTriageBotIntro,
} from "../agents/issue-triage.ts";

const originalTargetRepoPath = process.env.FLUE_TARGET_REPO_PATH;

afterEach(() => {
  if (originalTargetRepoPath === undefined) {
    delete process.env.FLUE_TARGET_REPO_PATH;
  } else {
    process.env.FLUE_TARGET_REPO_PATH = originalTargetRepoPath;
  }
});

const duplicate = {
  number: 950,
  title: "rewrite in rust",
  url: "https://github.com/getsentry/sentry-mcp/issues/950",
  state: "CLOSED",
  confidence: "high" as const,
  reason: "same request",
};

describe("issue triage comments", () => {
  it("prepends an issue triage bot greeting when the model omits one", () => {
    assert.match(
      withIssueTriageBotIntro(
        "Thanks for the report. This appears to duplicate #950.",
      ),
      /^:wave: I'm Sentry Intern, the issue triage bot\./,
    );
  });

  it("accepts varied wording when the first sentence identifies the bot", () => {
    const body =
      "Hello, I'm Sentry Intern, your triage bot.\n\nI cleaned this up for maintainers.";

    assert.equal(hasIssueTriageBotIntro(body), true);
    assert.equal(withIssueTriageBotIntro(body), body);
  });

  it("prepends the greeting when the persona is missing", () => {
    const body =
      "Hello, I'm the issue triage bot.\n\nI cleaned this up for maintainers.";

    assert.equal(hasIssueTriageBotIntro(body), false);
    assert.match(
      withIssueTriageBotIntro(body) ?? "",
      /^:wave: I'm Sentry Intern/,
    );
  });

  it("prepends the greeting when only a later sentence identifies the bot", () => {
    const body =
      "Thanks for the report. I'm Sentry Intern, the issue triage bot, and found a duplicate.";

    assert.equal(hasIssueTriageBotIntro(body), false);
    assert.match(
      withIssueTriageBotIntro(body) ?? "",
      /^:wave: I'm Sentry Intern/,
    );
  });
});

describe("duplicate closure", () => {
  it("inherits not planned when the canonical issue was closed as wontfix", () => {
    assert.equal(
      wasClosedAsNotPlanned({
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
      }),
      true,
    );
  });

  it("does not treat ordinary duplicate closure as not planned", () => {
    assert.equal(
      wasClosedAsNotPlanned({
        state: "CLOSED",
        stateReason: "DUPLICATE",
      }),
      false,
    );
  });

  it("explains not planned duplicate closure without using duplicate-only copy", () => {
    assert.match(
      buildDuplicateClosureComment(duplicate, true),
      /already closed as not planned/,
    );
  });

  it("describes duplicate closure after it has succeeded", () => {
    assert.match(buildDuplicateClosureComment(duplicate, false), /I've kept/);
    assert.doesNotMatch(
      buildDuplicateClosureComment(duplicate, false),
      /I'm keeping/,
    );
  });

  it("detects whether gh can link duplicate closures", () => {
    assert.equal(
      hasDuplicateOfFlag("      --duplicate-of int   Issue number"),
      true,
    );
    assert.equal(hasDuplicateOfFlag("      --reason string      Reason"), false);
  });

  it("detects whether gh supports duplicate close reasons", () => {
    assert.equal(
      hasDuplicateReason(
        "      --reason string   Reason for closing: {completed|not planned|duplicate}",
      ),
      true,
    );
    assert.equal(hasDuplicateReason("      --reason string      Reason"), false);
  });

  it("detects supported close reasons from gh help text", () => {
    const helpText =
      "      --reason string   Reason for closing: {completed|not planned}";

    assert.equal(hasCloseReason(helpText, "completed"), true);
    assert.equal(hasNotPlannedReason(helpText), true);
    assert.equal(hasCloseReason(helpText, "duplicate"), false);
  });

  it("prefers linked duplicate closure when gh supports it", () => {
    assert.equal(
      buildDuplicateCloseArgs(
        duplicate.number,
        "      --duplicate-of int   Issue number\n      --reason string",
      ),
      " --duplicate-of 950",
    );
  });

  it("falls back to duplicate close reason for older gh versions", () => {
    assert.equal(
      buildDuplicateCloseArgs(
        duplicate.number,
        "      --reason string   Reason for closing: {completed|not planned|duplicate}",
      ),
      " --reason duplicate",
    );
  });

  it("builds not planned close args only when supported", () => {
    assert.equal(
      buildNotPlannedCloseArgs(
        "      --reason string   Reason for closing: {completed|not planned}",
      ),
      " --reason 'not planned'",
    );
    assert.throws(
      () => buildNotPlannedCloseArgs("      --reason string      Reason"),
      /cannot close issues as not planned/,
    );
  });

  it("extracts the repository from GitHub issue URLs", () => {
    assert.equal(
      issueRepositoryFromUrl(
        "https://github.com/getsentry/sentry-mcp/issues/950",
      ),
      "getsentry/sentry-mcp",
    );
    assert.equal(issueRepositoryFromUrl("https://example.com/issues/950"), null);
  });

  it("extracts the repository from GitHub issue objects", () => {
    assert.equal(
      issueRepositoryFromIssue({
        url: "https://github.com/getsentry/sentry-mcp/issues/952",
      }),
      "getsentry/sentry-mcp",
    );
  });
});

describe("repository preparation", () => {
  it("reports unavailable when the prepared checkout path is missing", async () => {
    process.env.FLUE_TARGET_REPO_PATH = join(
      tmpdir(),
      `missing-flue-checkout-${Date.now()}`,
    );
    const session = {
      shell: async () => {
        throw new Error("shell should not run for a missing checkout path");
      },
    } as unknown as FlueSession;

    const result = await prepareRepository(session);

    assert.equal(result.checkoutAvailable, false);
    assert.equal(result.repoPath, null);
  });
});
