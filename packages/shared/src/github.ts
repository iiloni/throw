import { z } from 'zod';
import { timestampSchema } from './sync';

/** A project's connection to one GitHub repository (ADR 0017). Server-only, never synced. */

export const GITHUB_HEADERS = {
  event: 'X-GitHub-Event',
  delivery: 'X-GitHub-Delivery',
  signature: 'X-Hub-Signature-256',
} as const;

/** Pasted into the GitHub webhook's Secret field. */
export const GITHUB_WEBHOOK_SECRET_PREFIX = 'throw_ghsec_';

/** The inbound path, followed by the connection's URL token. */
export const GITHUB_WEBHOOK_PATH = '/api/integrations/github/webhooks';

/** GitHub caps a webhook payload at 25 MB. */
export const MAX_GITHUB_WEBHOOK_BYTES = 25 * 1024 * 1024;

// GitHub's rules: owners are 1–39 letters, digits or inner hyphens; repository names are
// letters, digits, `.`, `-` and `_`, other than `.` and `..`.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;

/**
 * `owner/repo` from what a person pastes: the name itself, or the repository's address in
 * any of the forms GitHub shows (`https://github.com/o/r`, `…/o/r.git`, `git@github.com:o/r`).
 * Null when it names no repository.
 */
export function parseGithubRepository(input: string): string | null {
  let value = input.trim();
  const ssh = /^git@[^:/\s]+:(.+)$/.exec(value);
  if (ssh) value = ssh[1]!;
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return null;
    }
  }
  const parts = value
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts as [string, string];
  return OWNER.test(owner) && REPO.test(repo) ? `${owner}/${repo}` : null;
}

/** GitHub compares owner and repository names without regard to case. */
export const sameGithubRepository = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const githubRepositorySchema = z
  .string()
  .max(300)
  .transform((value, context) => {
    const parsed = parseGithubRepository(value);
    if (!parsed) {
      context.addIssue({ code: 'custom', message: 'Enter a repository as owner/name' });
      return z.NEVER;
    }
    return parsed;
  });

/**
 * `webhook`: Throw receives GitHub's signed webhooks and calls nothing. `token`: it also holds
 * a personal access token for the integration's later calls to GitHub. A GitHub App mode is
 * planned (ADR 0017) and would add its own value.
 */
export const githubAuthModeSchema = z.enum(['webhook', 'token']);
export type GithubAuthMode = z.infer<typeof githubAuthModeSchema>;

/** A personal access token: printable, without spaces. GitHub's own formats vary by host. */
export const githubTokenSchema = z
  .string()
  .trim()
  .min(20)
  .max(255)
  .regex(/^[\x21-\x7e]+$/, 'Paste the whole token');

export const createGithubConnectionSchema = z
  .strictObject({
    repository: githubRepositorySchema,
    authMode: githubAuthModeSchema.default('webhook'),
    token: githubTokenSchema.optional(),
  })
  .refine((body) => (body.authMode === 'token') === (body.token !== undefined), {
    message: 'A token connection needs a token, and only it takes one',
    path: ['token'],
  });

/**
 * The events a project can move tasks on (ADR 0017), each to one of its own statuses. Every
 * rule is off until a status is chosen for it.
 *
 * - `prDraftOpened`: a linked pull request opens, reopens or is converted to a draft.
 * - `prReadyForReview`: a linked pull request opens or reopens ready for review, or leaves
 *   draft (`ready_for_review`).
 * - `prMerged` / `prClosed`: the task's last open pull request closes; merged when any of the
 *   task's pull requests merged.
 * - `issueClosed`: the task's last open linked issue closes.
 */
export const GITHUB_STATUS_TRIGGERS = [
  'prDraftOpened',
  'prReadyForReview',
  'prMerged',
  'prClosed',
  'issueClosed',
] as const;
export type GithubStatusTrigger = (typeof GITHUB_STATUS_TRIGGERS)[number];

/** Each trigger's target status, or null when the rule is off. */
export const githubStatusRulesSchema = z.object({
  prDraftOpened: z.uuid().nullable(),
  prReadyForReview: z.uuid().nullable(),
  prMerged: z.uuid().nullable(),
  prClosed: z.uuid().nullable(),
  issueClosed: z.uuid().nullable(),
});
export type GithubStatusRules = z.infer<typeof githubStatusRulesSchema>;

export const NO_GITHUB_STATUS_RULES: GithubStatusRules = {
  prDraftOpened: null,
  prReadyForReview: null,
  prMerged: null,
  prClosed: null,
  issueClosed: null,
};

/** The rules a request changes. A rule it leaves out keeps its status. */
export const githubStatusRulesUpdateSchema = githubStatusRulesSchema.partial().strict();

/**
 * `token` replaces the stored token. Switching to `webhook` forgets it; switching to `token`
 * needs one unless the connection already holds it.
 */
export const updateGithubConnectionSchema = z
  .strictObject({
    repository: githubRepositorySchema,
    authMode: githubAuthModeSchema,
    token: githubTokenSchema,
    enabled: z.boolean(),
    statusRules: githubStatusRulesUpdateSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Change at least one field')
  .refine((body) => !(body.authMode === 'webhook' && body.token !== undefined), {
    message: 'A webhook-only connection takes no token',
    path: ['token'],
  });

/**
 * `ok`: a handler took it, or it was GitHub's ping. `ignored`: verified, but nothing in Throw
 * follows that event yet, or the connection is off. `error`: refused, with the reason.
 */
export const githubDeliveryStatusSchema = z.enum(['ok', 'ignored', 'error']);
export type GithubDeliveryStatus = z.infer<typeof githubDeliveryStatusSchema>;

export const githubDeliverySchema = z.object({
  at: timestampSchema,
  /** GitHub's `X-GitHub-Delivery`, when the request had one. */
  id: z.string().nullable(),
  event: z.string().nullable(),
  status: githubDeliveryStatusSchema,
  /** Why it was ignored or refused. */
  detail: z.string().nullable(),
});
export type GithubDelivery = z.infer<typeof githubDeliverySchema>;

export const githubConnectionSchema = z.object({
  projectId: z.uuid(),
  workspaceId: z.uuid(),
  repository: z.string(),
  authMode: githubAuthModeSchema,
  enabled: z.boolean(),
  /** Whether a token is stored. The token itself is never returned. */
  hasToken: z.boolean(),
  /** Where GitHub sends this project's webhooks. Not a secret: deliveries must be signed. */
  webhookUrl: z.string(),
  createdAt: timestampSchema,
  lastDelivery: githubDeliverySchema.nullable(),
  /** Absent from servers older than the status rules, which cannot store them. */
  statusRules: githubStatusRulesSchema.optional(),
});
export type GithubConnection = z.infer<typeof githubConnectionSchema>;

export const githubConnectionResponseSchema = z.object({
  connection: githubConnectionSchema.nullable(),
});

/** The webhook secret is returned once, when it is made. */
export const githubConnectionSecretResponseSchema = z.object({
  secret: z.string(),
  connection: githubConnectionSchema,
});

export type CreateGithubConnection = z.input<typeof createGithubConnectionSchema>;
export type UpdateGithubConnection = z.input<typeof updateGithubConnectionSchema>;
export type GithubConnectionResponse = z.infer<typeof githubConnectionResponseSchema>;

const kind = z.enum(['pr', 'issue']);
const state = z.enum(['draft', 'open', 'merged', 'closed']);
export const githubChecksSchema = z.object({
  state: z.enum(['passing', 'failing', 'pending', 'neutral']),
  passed: z.int().nonnegative(),
  failed: z.int().nonnegative(),
  pending: z.int().nonnegative(),
});
export const taskGithubLinkSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid(),
  repo: z.string(),
  kind,
  number: z.int().positive(),
  url: z.url(),
  title: z.string(),
  state,
  reviewDecision: z.enum(['approved', 'changes_requested', 'pending']).nullable(),
  checksSummary: githubChecksSchema.nullable(),
  branch: z.string().nullable(),
  mergeCommitSha: z.string().nullable(),
  mergedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type TaskGithubLink = z.infer<typeof taskGithubLinkSchema>;

export function parseGithubLink(url: string) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/([1-9]\d*)\/?$/i.exec(
    url,
  );
  if (!match || !parseGithubRepository(match[1]!) || Number(match[3]) > 2147483647) return null;
  const repo = match[1]!.toLowerCase();
  const kind = match[2]!.toLowerCase() === 'pull' ? 'pr' : 'issue';
  const number = Number(match[3]);
  return { repo, kind, number, url: githubItemUrl(repo, kind, number) } as const;
}
export function githubItemUrl(repo: string, kind: TaskGithubLink['kind'], number: number) {
  return `https://github.com/${repo}/${kind === 'pr' ? 'pull' : 'issues'}/${number}`;
}
export const linkGithubRequestSchema = z.object({
  url: z
    .string()
    .max(512)
    .refine((url) => !!parseGithubLink(url), 'Enter a GitHub pull request or issue URL'),
  title: z.string().trim().min(1).max(1024).optional(),
  state: state.optional(),
});

export const createGithubReleaseSchema = z.strictObject({
  repo: githubRepositorySchema,
  tagName: z.string().min(1).max(1024),
  name: z.string().max(2048).nullable().optional(),
  targetCommitish: z.string().max(1024).nullable().optional(),
  isDraft: z.boolean().optional(),
  isPrerelease: z.boolean().optional(),
  publishedAt: timestampSchema.nullable().optional(),
});
export type CreateGithubRelease = z.input<typeof createGithubReleaseSchema>;
export const githubReleaseSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  repo: z.string(),
  tagName: z.string(),
  name: z.string().nullable(),
  url: z.url(),
  targetCommitish: z.string().nullable(),
  source: z.enum(['release', 'tag', 'manual']),
  isDraft: z.boolean(),
  isPrerelease: z.boolean(),
  publishedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type GithubRelease = z.infer<typeof githubReleaseSchema>;
export const githubReleasesResponseSchema = z.object({ releases: z.array(githubReleaseSchema) });
export const taskGithubReleaseSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid(),
  releaseId: z.uuid(),
  matchedBy: z.enum(['manual', 'window', 'ancestry']),
  createdAt: timestampSchema,
});
export type TaskGithubRelease = z.infer<typeof taskGithubReleaseSchema>;
