import { describe, expect, it } from "vitest";

import {
  buildDuplicateClosureComment,
  hasDuplicateOfFlag,
  hasIssueTriageBotIntro,
  wasClosedAsNotPlanned,
  withIssueTriageBotIntro,
} from "../agents/issue-triage";

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
    expect(
      withIssueTriageBotIntro(
        "Thanks for the report. This appears to duplicate #950.",
      ),
    ).toMatch(/^:wave: I'm Sentry Intern, the issue triage bot\./);
  });

  it("accepts varied wording when the first sentence identifies the bot", () => {
    const body =
      "Hello, I'm Sentry Intern, your triage bot.\n\nI cleaned this up for maintainers.";

    expect(hasIssueTriageBotIntro(body)).toBe(true);
    expect(withIssueTriageBotIntro(body)).toBe(body);
  });

  it("prepends the greeting when the persona is missing", () => {
    const body =
      "Hello, I'm the issue triage bot.\n\nI cleaned this up for maintainers.";

    expect(hasIssueTriageBotIntro(body)).toBe(false);
    expect(withIssueTriageBotIntro(body)).toMatch(/^:wave: I'm Sentry Intern/);
  });

  it("prepends the greeting when only a later sentence identifies the bot", () => {
    const body =
      "Thanks for the report. I'm Sentry Intern, the issue triage bot, and found a duplicate.";

    expect(hasIssueTriageBotIntro(body)).toBe(false);
    expect(withIssueTriageBotIntro(body)).toMatch(/^:wave: I'm Sentry Intern/);
  });
});

describe("duplicate closure", () => {
  it("inherits not planned when the canonical issue was closed as wontfix", () => {
    expect(
      wasClosedAsNotPlanned({
        state: "CLOSED",
        stateReason: "NOT_PLANNED",
      }),
    ).toBe(true);
  });

  it("does not treat ordinary duplicate closure as not planned", () => {
    expect(
      wasClosedAsNotPlanned({
        state: "CLOSED",
        stateReason: "DUPLICATE",
      }),
    ).toBe(false);
  });

  it("explains not planned duplicate closure without using duplicate-only copy", () => {
    expect(buildDuplicateClosureComment(duplicate, true)).toContain(
      "already closed as not planned",
    );
  });

  it("detects whether gh can link duplicate closures", () => {
    expect(hasDuplicateOfFlag("      --duplicate-of int   Issue number")).toBe(
      true,
    );
    expect(hasDuplicateOfFlag("      --reason string      Reason")).toBe(false);
  });
});
