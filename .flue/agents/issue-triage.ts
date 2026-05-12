import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FlueContext, FlueSession } from "@flue/sdk/client";
import { defineCommand } from "@flue/sdk/node";
import * as v from "valibot";

export const triggers = {};

const repositorySchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
);

const payloadSchema = v.object({
  issueNumber: v.pipe(v.number(), v.integer(), v.minValue(1)),
  repository: v.optional(repositorySchema),
});

const severitySchema = v.picklist(["low", "medium", "high", "critical"]);
const categorySchema = v.picklist([
  "bug",
  "documentation",
  "feature_request",
  "support",
  "security",
  "maintenance",
  "unknown",
]);
const dispositionSchema = v.picklist([
  "actionable",
  "needs_more_info",
  "low_actionability",
  "impractical_scope",
  "unclear",
]);

const duplicateCandidateSchema = v.object({
  number: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.string(),
  url: v.string(),
  state: v.string(),
  confidence: v.picklist(["low", "medium", "high"]),
  reason: v.string(),
});

export const duplicateSearchSchema = v.object({
  status: v.picklist(["duplicate", "unique", "uncertain"]),
  duplicate: v.nullish(duplicateCandidateSchema),
  candidates: v.array(duplicateCandidateSchema),
  rationale: v.string(),
});
type DuplicateSearch = v.InferOutput<typeof duplicateSearchSchema>;
type DuplicateCandidate = v.InferOutput<typeof duplicateCandidateSchema>;
type DuplicateClosureResult = {
  labelsApplied: string[];
  commentPosted: boolean;
  closed: boolean;
  closeAsNotPlanned: boolean;
  failureSummary?: string;
};

const diagnosisSchema = v.object({
  severity: severitySchema,
  category: categorySchema,
  disposition: dispositionSchema,
  validity: v.picklist(["confirmed", "likely", "not_reproducible", "unclear"]),
  summary: v.string(),
  evidence: v.array(v.string()),
  labels_to_apply: v.array(v.string()),
  should_comment: v.boolean(),
  triage_comment: v.optional(v.string()),
  needs_human_review: v.boolean(),
});
type Diagnosis = v.InferOutput<typeof diagnosisSchema>;

type TriageUpdateResult = {
  labels_applied: string[];
  comment_posted: boolean;
  needs_human_review: boolean;
  summary: string;
};

const TRIAGE_FAILURE_MESSAGE =
  "The triage workflow failed before producing structured output.";

function safeFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Installed gh CLI cannot close issues")) {
    return message;
  }
  return TRIAGE_FAILURE_MESSAGE;
}

function buildDuplicateSearchFailure(): DuplicateSearch {
  return {
    status: "uncertain",
    candidates: [],
    rationale: TRIAGE_FAILURE_MESSAGE,
  };
}

function buildDiagnosisFailure(): Diagnosis {
  return {
    severity: "low",
    category: "unknown",
    disposition: "unclear",
    validity: "unclear",
    summary:
      "Automated triage could not complete, so the issue is left unchanged for maintainer review.",
    evidence: [TRIAGE_FAILURE_MESSAGE],
    labels_to_apply: [],
    should_comment: false,
    needs_human_review: true,
  };
}

const gh = defineCommand("gh", {
  env: {
    GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
  },
});
const readGhToken = process.env.FLUE_READ_GH_TOKEN ?? "";
const readOnlyGh = defineCommand("gh", {
  env: { GH_TOKEN: readGhToken, GITHUB_TOKEN: readGhToken },
});

// pi-ai currently replays OpenAI Responses reasoning IDs with store=false.
// Inline encrypted reasoning until Flue/pi-ai expose this cleanly.
type ResponsesPayload = {
  include?: string[];
  reasoning?: { effort?: string; summary?: string };
};
type ResponsesModel = { api?: string; reasoning?: boolean };
type Harness = {
  onPayload?: (
    params: ResponsesPayload,
    model: ResponsesModel,
  ) => ResponsesPayload | undefined;
};
type SessionWithHarness = FlueSession & { harness: Harness };

const REASONING_RESPONSES_APIS = new Set([
  "openai-responses",
  "azure-openai-responses",
]);

function enableEncryptedReasoning(session: FlueSession) {
  const harness = (session as SessionWithHarness).harness;
  if (!harness || typeof harness !== "object") {
    return;
  }
  harness.onPayload = (params, model) => {
    if (!model?.reasoning || !REASONING_RESPONSES_APIS.has(model.api ?? "")) {
      return params;
    }
    const include = new Set(
      Array.isArray(params.include) ? params.include : [],
    );
    include.add("reasoning.encrypted_content");
    params.include = Array.from(include);
    return params;
  };
}

type IssueContext = {
  issueNumber: number;
  repository?: string;
  issue: unknown;
  labels: unknown;
  fetchedAt: string;
};

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function repoArg(repository?: string) {
  return repository ? ` --repo ${shellQuote(repository)}` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getIssueState(context: IssueContext) {
  if (!isRecord(context.issue) || typeof context.issue.state !== "string") {
    return null;
  }
  return context.issue.state.toLowerCase();
}

function existingLabels(context: IssueContext) {
  if (!Array.isArray(context.labels)) {
    return new Map<string, string>();
  }
  const labels = new Map<string, string>();
  for (const label of context.labels) {
    if (isRecord(label) && typeof label.name === "string") {
      labels.set(label.name.toLowerCase(), label.name);
    }
  }
  return labels;
}

function filterExistingLabels(context: IssueContext, labels: string[]) {
  const available = existingLabels(context);
  const result = new Map<string, string>();
  for (const label of labels) {
    const existing = available.get(label.toLowerCase());
    if (existing) {
      result.set(existing.toLowerCase(), existing);
    }
  }
  return Array.from(result.values());
}

function findDuplicateLabel(context: IssueContext) {
  return existingLabels(context).get("duplicate") ?? null;
}

export const TRIAGE_BOT_INTRO =
  ":wave: I'm Sentry Intern, the issue triage bot.";

export function withIssueTriageBotIntro(body?: string) {
  const trimmed = body?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith(TRIAGE_BOT_INTRO)) {
    return trimmed;
  }
  return `${TRIAGE_BOT_INTRO}\n\n${trimmed}`;
}

function normalizeStateReason(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.toLowerCase().replace(/[\s-]+/g, "_");
}

export function issueRepositoryFromUrl(url: string) {
  return issueReferenceFromUrl(url)?.repository ?? null;
}

export function issueReferenceFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") {
      return null;
    }

    const [owner, name, type, number] = parsed.pathname
      .split("/")
      .filter(Boolean);
    if (
      !owner ||
      !name ||
      type !== "issues" ||
      !number ||
      !/^[1-9][0-9]*$/.test(number)
    ) {
      return null;
    }

    return {
      repository: `${owner}/${name}`,
      number: Number(number),
    };
  } catch {
    return null;
  }
}

export function issueRepositoryFromIssue(issue: unknown) {
  if (!isRecord(issue) || typeof issue.url !== "string") {
    return null;
  }

  return issueRepositoryFromUrl(issue.url);
}

export function validateDuplicateForAutomaticClosure(
  issueNumber: number,
  currentRepository: string | null,
  duplicate: DuplicateCandidate,
) {
  if (!currentRepository) {
    return "current issue repository could not be validated";
  }

  if (duplicate.confidence !== "high") {
    return `candidate confidence was ${duplicate.confidence}`;
  }

  if (duplicate.number === issueNumber) {
    return "candidate matched the current issue";
  }

  const reference = issueReferenceFromUrl(duplicate.url);
  if (!reference) {
    return "candidate URL did not identify a same-repo GitHub issue";
  }

  if (reference.repository.toLowerCase() !== currentRepository.toLowerCase()) {
    return `cross-repo candidate from ${reference.repository}`;
  }

  if (reference.number !== duplicate.number) {
    return "candidate URL did not match candidate issue number";
  }

  return null;
}

export function wasClosedAsNotPlanned(issue: unknown) {
  if (!isRecord(issue)) {
    return false;
  }

  const state =
    typeof issue.state === "string" ? issue.state.toLowerCase() : "";
  return (
    state === "closed" &&
    ["not_planned", "wontfix", "wont_fix"].includes(
      normalizeStateReason(issue.stateReason),
    )
  );
}

async function readJsonCommand(
  session: FlueSession,
  command: string,
  description: string,
  commandDef: typeof gh = readOnlyGh,
) {
  const result = await session.shell(command, {
    commands: [commandDef],
    timeout: 60_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${description} failed: ${result.stderr || result.stdout}`.trim(),
    );
  }

  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${description} returned invalid JSON: ${message}`);
  }
}

async function runGhCommand(
  session: FlueSession,
  command: string,
  description: string,
) {
  const result = await session.shell(command, {
    commands: [gh],
    timeout: 60_000,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${description} failed: ${result.stderr || result.stdout}`.trim(),
    );
  }
}

export function hasDuplicateOfFlag(helpText: string) {
  return helpText.includes("--duplicate-of");
}

export function hasCloseReason(helpText: string, reason: string) {
  const match = helpText.match(/Reason for closing:\s*\{([^}]*)\}/);

  return match
    ? match[1].split("|").some((supportedReason) => {
        return supportedReason.trim() === reason;
      })
    : false;
}

export function hasDuplicateReason(helpText: string) {
  return hasCloseReason(helpText, "duplicate");
}

export function hasNotPlannedReason(helpText: string) {
  return hasCloseReason(helpText, "not planned");
}

export function buildDuplicateCloseArgs(duplicateNumber: number, helpText: string) {
  if (hasDuplicateOfFlag(helpText)) {
    return ` --duplicate-of ${duplicateNumber}`;
  }

  if (hasDuplicateReason(helpText)) {
    return " --reason duplicate";
  }

  throw new Error("Installed gh CLI cannot close issues as duplicates.");
}

export function buildNotPlannedCloseArgs(helpText: string) {
  if (hasNotPlannedReason(helpText)) {
    return ` --reason ${shellQuote("not planned")}`;
  }

  throw new Error("Installed gh CLI cannot close issues as not planned.");
}

let issueCloseHelpText: string | undefined;

async function getIssueCloseHelpText(session: FlueSession) {
  if (issueCloseHelpText !== undefined) {
    return issueCloseHelpText;
  }

  const result = await session.shell("gh issue close --help", {
    commands: [gh],
    timeout: 60_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Checking gh issue close support failed: ${result.stderr || result.stdout}`,
    );
  }

  issueCloseHelpText = `${result.stdout}\n${result.stderr}`;
  return issueCloseHelpText;
}

async function withGhBodyFile<T>(
  prefix: string,
  body: string,
  callback: (path: string) => Promise<T>,
) {
  const dir = await mkdtemp(join(tmpdir(), "issue-triage-"));
  const path = join(dir, `${prefix}.md`);

  await writeFile(path, body, "utf8");

  try {
    return await callback(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function applyLabels(
  session: FlueSession,
  context: IssueContext,
  labels: string[],
) {
  const repo = repoArg(context.repository);
  const applied: string[] = [];

  for (const label of filterExistingLabels(context, labels)) {
    await runGhCommand(
      session,
      `gh issue edit ${context.issueNumber}${repo} --add-label ${shellQuote(label)}`,
      `Applying label ${label}`,
    );
    applied.push(label);
  }

  return applied;
}

async function postComment(
  session: FlueSession,
  context: IssueContext,
  body?: string,
) {
  const comment = withIssueTriageBotIntro(body);
  if (!comment) {
    return false;
  }

  await withGhBodyFile(
    `issue-${context.issueNumber}-comment`,
    comment,
    (path) =>
      runGhCommand(
        session,
        `gh issue comment ${context.issueNumber}${repoArg(context.repository)} --body-file ${shellQuote(path)}`,
        "Posting issue comment",
      ),
  );
  return true;
}

async function readIssueClosureContext(
  session: FlueSession,
  issueNumber: number,
  repository?: string,
) {
  return readJsonCommand(
    session,
    `gh issue view ${issueNumber}${repoArg(repository)} --json number,title,state,stateReason,url`,
    `Fetching canonical duplicate #${issueNumber}`,
  );
}

export function buildDuplicateClosureComment(
  duplicate: DuplicateCandidate,
  closeAsNotPlanned: boolean,
) {
  if (closeAsNotPlanned) {
    return [
      `Quick triage read: this matches #${duplicate.number}, which was already closed as not planned.`,
      "",
      "I've closed this with the same resolution so we don't keep two copies of the same ask open.",
    ].join("\n");
  }

  return [
    `Quick triage read: this looks like the same request as #${duplicate.number}.`,
    "",
    `I've kept the thread tidy by closing this one so updates stay on #${duplicate.number}.`,
  ].join("\n");
}

async function closeDuplicate(
  session: FlueSession,
  context: IssueContext,
  duplicate: DuplicateCandidate,
  canonicalIssue?: unknown,
): Promise<DuplicateClosureResult> {
  const duplicateLabel = findDuplicateLabel(context);
  let failureSummary: string | undefined;
  let labelsApplied: string[] = [];
  const closeAsNotPlanned = wasClosedAsNotPlanned(canonicalIssue);
  const comment = buildDuplicateClosureComment(duplicate, closeAsNotPlanned);
  let commentPosted = false;

  try {
    if (closeAsNotPlanned) {
      const closeArgs = buildNotPlannedCloseArgs(
        await getIssueCloseHelpText(session),
      );
      await runGhCommand(
        session,
        `gh issue close ${context.issueNumber}${repoArg(context.repository)}${closeArgs}`,
        "Closing issue as not planned",
      );
    } else {
      const closeArgs = buildDuplicateCloseArgs(
        duplicate.number,
        await getIssueCloseHelpText(session),
      );
      await runGhCommand(
        session,
        `gh issue close ${context.issueNumber}${repoArg(context.repository)}${closeArgs}`,
        "Closing duplicate issue",
      );
    }
  } catch (error) {
    const summary = `Closing duplicate issue failed: ${safeFailureMessage(error)}`;
    failureSummary = summary;
    console.warn(`[issue-triage] ${summary}`);

    return {
      labelsApplied,
      commentPosted,
      closed: false,
      closeAsNotPlanned,
      failureSummary,
    };
  }

  if (duplicateLabel) {
    try {
      labelsApplied = await applyLabels(session, context, [duplicateLabel]);
    } catch (error) {
      failureSummary = `Applying duplicate label failed: ${safeFailureMessage(error)}`;
      console.warn(`[issue-triage] ${failureSummary}`);
    }
  }

  try {
    commentPosted = await postComment(session, context, comment);
  } catch (error) {
    const summary = `Posting duplicate closure comment failed: ${safeFailureMessage(error)}`;
    failureSummary = failureSummary ? `${failureSummary}; ${summary}` : summary;
    console.warn(`[issue-triage] ${summary}`);
  }

  return {
    labelsApplied,
    commentPosted,
    closed: true,
    closeAsNotPlanned,
    failureSummary,
  };
}

function selectTriageComment(
  diagnosis: v.InferOutput<typeof diagnosisSchema>,
) {
  if (!diagnosis.should_comment) {
    return undefined;
  }

  return (
    diagnosis.triage_comment?.trim() ||
    `Quick triage read: ${diagnosis.summary.trim() || "This needs maintainer review."}`
  );
}

export async function applyTriageUpdate(
  session: FlueSession,
  context: IssueContext,
  diagnosis: v.InferOutput<typeof diagnosisSchema>,
): Promise<TriageUpdateResult> {
  if (getIssueState(context) === "closed") {
    return {
      labels_applied: [],
      comment_posted: false,
      needs_human_review: true,
      summary: "Skipped triage update because the issue is already closed.",
    };
  }

  if (diagnosis.needs_human_review) {
    return {
      labels_applied: [],
      comment_posted: false,
      needs_human_review: true,
      summary: "Skipped triage update because human review is required.",
    };
  }

  const failureSummaries: string[] = [];
  let labelsApplied: string[] = [];
  let commentPosted = false;

  try {
    labelsApplied = await applyLabels(
      session,
      context,
      diagnosis.labels_to_apply,
    );
  } catch (error) {
    const summary = `Applying issue labels failed: ${safeFailureMessage(error)}`;
    failureSummaries.push(summary);
    console.warn(`[issue-triage] ${summary}`);
  }

  const comment = selectTriageComment(diagnosis);
  if (comment) {
    try {
      commentPosted = await postComment(session, context, comment);
    } catch (error) {
      const summary = `Posting issue comment failed: ${safeFailureMessage(error)}`;
      failureSummaries.push(summary);
      console.warn(`[issue-triage] ${summary}`);
    }
  }

  const changed = [
    labelsApplied.length > 0 ? "labels" : null,
    commentPosted ? "comment" : null,
  ].filter(Boolean);

  return {
    labels_applied: labelsApplied,
    comment_posted: commentPosted,
    needs_human_review:
      diagnosis.needs_human_review || failureSummaries.length > 0,
    summary:
      failureSummaries.length > 0
        ? `Issue update needs maintainer review: ${failureSummaries.join("; ")}`
        : changed.length > 0
          ? `Updated issue ${changed.join(", ")}.`
          : "No issue update was needed.",
  };
}

async function readIssueContext(
  session: FlueSession,
  issueNumber: number,
  repository?: string,
): Promise<IssueContext> {
  const repo = repoArg(repository);
  const issue = await readJsonCommand(
    session,
    `gh issue view ${issueNumber}${repo} --json title,body,author,labels,comments,url,state,createdAt,updatedAt`,
    "Fetching issue context",
  );
  const labels = await readJsonCommand(
    session,
    `gh label list${repo} --limit 200 --json name,description`,
    "Fetching repository labels",
  );
  const context: IssueContext = {
    issueNumber,
    issue,
    labels,
    fetchedAt: new Date().toISOString(),
  };

  if (repository) {
    context.repository = repository;
  }

  return context;
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function prepareRepository() {
  const repoPath = process.env.FLUE_TARGET_REPO_PATH;
  if (!repoPath) {
    return {
      checkoutAvailable: false,
      repoPath: null,
      checkoutNote: "No target repository checkout path was provided.",
    };
  }

  if (
    !(await isDirectory(repoPath)) ||
    !(await isDirectory(join(repoPath, ".git")))
  ) {
    return {
      checkoutAvailable: false,
      repoPath: null,
      checkoutNote: `Target repository checkout is not available: ${repoPath}`,
    };
  }

  return {
    checkoutAvailable: true,
    repoPath,
    checkoutNote:
      "Using the target repository checkout prepared by GitHub Actions.",
  };
}

async function runTriage(session: FlueSession, issueNumber: number, repository?: string) {
  const initialContext = await readIssueContext(session, issueNumber, repository);
  let duplicateSearch: DuplicateSearch;
  try {
    duplicateSearch = await session.skill("issue-triage", {
      args: {
        stage: "search-duplicates",
        issueNumber,
        repository,
        context: initialContext,
      },
      commands: [readOnlyGh],
      result: duplicateSearchSchema,
      timeout: 300_000,
    });
  } catch (error) {
    console.warn(
      `[issue-triage] Duplicate search failed: ${safeFailureMessage(error)}`,
    );
    duplicateSearch = buildDuplicateSearchFailure();
  }

  if (duplicateSearch.status === "duplicate") {
    if (!duplicateSearch.duplicate) {
      throw new Error(
        `Duplicate search returned duplicate status without a canonical issue for #${issueNumber}.`,
      );
    }

    const currentRepository =
      repository ?? issueRepositoryFromIssue(initialContext.issue);
    const duplicateValidationFailure = validateDuplicateForAutomaticClosure(
      issueNumber,
      currentRepository,
      duplicateSearch.duplicate,
    );

    if (duplicateValidationFailure || !currentRepository) {
      return {
        outcome: "needs_human_review",
        steps: [
          { name: "search-duplicates", result: duplicateSearch.status },
          {
            name: "validate-duplicate",
            result:
              duplicateValidationFailure ??
              "current issue repository could not be validated",
          },
        ],
        duplicate: duplicateSearch.duplicate,
        labels_applied: [],
        comment_posted: false,
        needs_human_review: true,
        summary: `Found duplicate candidate #${duplicateSearch.duplicate.number}, but it needs maintainer review before automatic closure.`,
      };
    }

    const closureContext = await readIssueContext(
      session,
      issueNumber,
      currentRepository,
    );
    let canonicalIssue: unknown;
    try {
      canonicalIssue = await readIssueClosureContext(
        session,
        duplicateSearch.duplicate.number,
        currentRepository,
      );
    } catch (error) {
      const failureSummary = `Canonical duplicate lookup failed: ${safeFailureMessage(error)}`;
      console.warn(`[issue-triage] ${failureSummary}`);
      return {
        outcome: "needs_human_review",
        steps: [
          { name: "search-duplicates", result: duplicateSearch.status },
          { name: "validate-duplicate", result: "same-repo high-confidence" },
          { name: "fetch-canonical-duplicate", result: failureSummary },
        ],
        duplicate: duplicateSearch.duplicate,
        labels_applied: [],
        comment_posted: false,
        needs_human_review: true,
        summary: `Found duplicate #${duplicateSearch.duplicate.number}, but automatic closure needs maintainer review because the canonical issue could not be fetched.`,
      };
    }
    const closure = await closeDuplicate(
      session,
      closureContext,
      duplicateSearch.duplicate,
      canonicalIssue,
    );
    const closureResult = closure.closed
      ? closure.closeAsNotPlanned
        ? "closed_as_not_planned"
        : "closed"
      : "failed";
    const summary = closure.closed
      ? closure.closeAsNotPlanned
        ? `Closed as not planned because #${duplicateSearch.duplicate.number} was already closed as not planned.`
        : `Closed as a duplicate of #${duplicateSearch.duplicate.number}.`
      : `Found duplicate #${duplicateSearch.duplicate.number}, but automatic closure failed: ${closure.failureSummary ?? "unknown error"}.`;

    return {
      outcome: closure.closed
        ? closure.closeAsNotPlanned
          ? "duplicate_closed_as_not_planned"
          : "duplicate_closed"
        : "needs_human_review",
      steps: [
        { name: "search-duplicates", result: duplicateSearch.status },
        {
          name: "close-duplicate",
          result: closure.failureSummary
            ? `${closureResult}: ${closure.failureSummary}`
            : closureResult,
        },
      ],
      duplicate: duplicateSearch.duplicate,
      labels_applied: closure.labelsApplied,
      comment_posted: closure.commentPosted,
      needs_human_review: !closure.closed,
      summary,
    };
  }

  const repositoryContext = await prepareRepository();

  const diagnosisContext = await readIssueContext(
    session,
    issueNumber,
    repository,
  );
  let diagnosis: Diagnosis;
  try {
    diagnosis = await session.skill("issue-triage", {
      args: {
        stage: "diagnose-and-validate",
        issueNumber,
        repository,
        context: diagnosisContext,
        repositoryContext,
        duplicateSearch,
      },
      commands: [readOnlyGh],
      result: diagnosisSchema,
      timeout: 900_000,
    });
  } catch (error) {
    console.warn(
      `[issue-triage] Diagnosis failed: ${safeFailureMessage(error)}`,
    );
    diagnosis = buildDiagnosisFailure();
  }

  const updateContext = await readIssueContext(
    session,
    issueNumber,
    repository,
  );
  const update = await applyTriageUpdate(session, updateContext, diagnosis);

  return {
    outcome: update.needs_human_review ? "needs_human_review" : "triaged",
    steps: [
      { name: "search-duplicates", result: duplicateSearch.status },
      {
        name: "prepare-repository",
        result: repositoryContext.checkoutAvailable ? "ready" : "unavailable",
      },
      { name: "diagnose-and-validate", result: diagnosis.validity },
      { name: "apply-triage-update", result: update.summary },
    ],
    severity: diagnosis.severity,
    category: diagnosis.category,
    disposition: diagnosis.disposition,
    validity: diagnosis.validity,
    labels_applied: update.labels_applied,
    comment_posted: update.comment_posted,
    needs_human_review: update.needs_human_review,
    summary: update.summary,
  };
}

export default async function ({ init, payload }: FlueContext) {
  const { issueNumber, repository } = v.parse(payloadSchema, payload);
  if (!process.env.OPENAI_API_KEY && process.env.FLUE_OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.FLUE_OPENAI_API_KEY;
  }

  const agent = await init({
    sandbox: "local",
    model: process.env.FLUE_TRIAGE_MODEL || "openai/gpt-5.5",
  });
  const session = await agent.session();
  enableEncryptedReasoning(session);

  try {
    return await runTriage(session, issueNumber, repository);
  } catch (error) {
    const summary = `Automated triage failed: ${safeFailureMessage(error)}`;
    console.warn(`[issue-triage] ${summary}`);
    return {
      outcome: "needs_human_review",
      steps: [{ name: "triage", result: summary }],
      labels_applied: [],
      comment_posted: false,
      needs_human_review: true,
      summary,
    };
  }
}
