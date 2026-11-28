import type { GithubRelease, TaskGithubLink } from '@throw/shared';
import {
  Check,
  CircleCheck,
  CircleDot,
  Clock,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Rocket,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { IconButton } from '@/components/IconButton/IconButton';
import {
  GithubLinkError,
  githubChecksText,
  githubKindLabel,
  githubLinkLabel,
  githubReference,
  githubReviewLabel,
  githubStateLabel,
  githubTone,
  unlinkGithub,
} from '@/lib/githubLinks';
import { releaseQualifier, releaseShipped } from '@/lib/githubReleases';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

/** GitHub's own mark for each kind and state, so a glance reads like GitHub. */
export function GithubStateIcon({
  link,
  className,
}: {
  link: Pick<TaskGithubLink, 'kind' | 'state'>;
  className?: string;
}) {
  const Icon =
    link.kind === 'issue'
      ? link.state === 'closed'
        ? CircleCheck
        : CircleDot
      : link.state === 'merged'
        ? GitMerge
        : link.state === 'closed'
          ? GitPullRequestClosed
          : link.state === 'draft'
            ? GitPullRequestDraft
            : GitPullRequest;
  return <Icon aria-hidden className={className} />;
}

/**
 * The state as a quiet pill, then a pull request's review and checks, when GitHub has sent
 * them. Each count shows only when there is one.
 */
export function GithubLinkStatus({
  link,
  className,
}: {
  link: TaskGithubLink;
  className?: string;
}) {
  const checks = link.kind === 'pr' ? link.checksSummary : null;
  const review = link.kind === 'pr' ? link.reviewDecision : null;
  return (
    <span
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs',
        className,
      )}
    >
      <span
        data-color={githubTone({ ...link, checksSummary: null })}
        data-github-state={link.state}
        className="shrink-0 rounded-full bg-tint px-2 py-px font-medium text-[0.6875rem] text-tint-accent"
      >
        {githubStateLabel[link.state]}
      </span>
      {review && (
        <span
          data-github-review={review}
          className={cn(
            'shrink-0',
            review === 'approved' && 'text-foreground/75',
            review === 'changes_requested' && 'text-destructive',
          )}
        >
          {githubReviewLabel[review]}
        </span>
      )}
      {checks && checks.passed + checks.failed + checks.pending > 0 && (
        <span
          role="img"
          data-github-checks={checks.state}
          aria-label={`Checks: ${githubChecksText(checks)}`}
          className="flex shrink-0 items-center gap-1.5 tabular-nums"
        >
          {checks.failed > 0 && (
            <span className="flex items-center gap-0.5 text-destructive">
              <X aria-hidden className="size-3" strokeWidth={2.5} />
              {checks.failed}
            </span>
          )}
          {checks.pending > 0 && (
            <span className="flex items-center gap-0.5">
              <Clock aria-hidden className="size-3" />
              {checks.pending}
            </span>
          )}
          {checks.passed > 0 && (
            <span className="flex items-center gap-0.5">
              <Check aria-hidden className="size-3" strokeWidth={2.5} />
              {checks.passed}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** What a linked item says, laid out for the task pane's row and the card's preview alike. */
export function GithubLinkSummary({
  link,
  className,
}: {
  link: TaskGithubLink;
  className?: string;
}) {
  return (
    <span className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        <span
          data-color={githubTone({ ...link, checksSummary: null })}
          className="flex shrink-0 text-tint-accent"
        >
          <GithubStateIcon link={link} className="size-3.5" />
        </span>
        <span className="shrink-0 font-medium tabular-nums">#{link.number}</span>
        <span className="min-w-0 truncate">{link.repo}</span>
      </span>
      <span
        className={cn(
          'line-clamp-2 text-sm leading-snug [overflow-wrap:anywhere]',
          !(link.state === 'open' || link.state === 'draft') && 'text-foreground/70',
        )}
      >
        {link.title}
      </span>
      <GithubLinkStatus link={link} />
      {link.branch && (
        <span className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
          <GitBranch aria-hidden className="size-3 shrink-0" />
          <span className="min-w-0 truncate font-mono text-[0.6875rem]">{link.branch}</span>
        </span>
      )}
    </span>
  );
}

const pill =
  'flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2.5 text-xs font-medium';

/**
 * Where the task's work shipped, as quiet pills: each release or tag it is bound to, newest
 * first, opening it on GitHub, and Merged · unreleased while a merged pull request waits for a
 * shipped release. A release that is a draft, a pre-release, a bare tag or no longer published
 * says so beside its tag; only a shipped one takes the green mark.
 */
export function TaskReleases({
  releases,
  unreleased,
  className,
}: {
  releases: readonly GithubRelease[];
  unreleased: boolean;
  className?: string;
}) {
  if (releases.length === 0 && !unreleased) return null;
  return (
    <ul aria-label="Releases" className={cn('flex flex-wrap gap-1.5', className)}>
      {releases.map((release) => {
        const qualifier = releaseQualifier(release);
        const shipped = releaseShipped(release);
        return (
          <li key={release.id} data-release={release.tagName} className="flex min-w-0 max-w-full">
            <a
              href={release.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={[
                `Release ${release.tagName}`,
                release.name && release.name !== release.tagName && release.name,
                qualifier,
                'Open on GitHub',
              ]
                .filter(Boolean)
                .join('. ')}
              className={cn(
                pill,
                'text-foreground/85 outline-none transition-colors hover:bg-foreground/[0.09] focus-visible:ring-[3px] focus-visible:ring-ring/60',
              )}
            >
              <span
                data-color={shipped ? 'green' : 'gray'}
                className="flex shrink-0 text-tint-accent"
              >
                <Rocket aria-hidden className="size-3.5" />
              </span>
              <span className="min-w-0 truncate tabular-nums">{release.tagName}</span>
              {qualifier && (
                <span className="shrink-0 font-normal text-muted-foreground">{qualifier}</span>
              )}
            </a>
          </li>
        );
      })}
      {unreleased && (
        <li data-release="unreleased" className="flex min-w-0">
          <span className={cn(pill, 'text-muted-foreground')}>
            <span data-color="violet" className="flex shrink-0 text-tint-accent">
              <GitMerge aria-hidden className="size-3.5" />
            </span>
            Merged · unreleased
          </span>
        </li>
      )}
    </ul>
  );
}

/**
 * A task's pull requests and issues, as its relations are listed: one row per item that opens
 * it on GitHub, kept current as webhooks arrive, with a remove button that is always shown,
 * since a touch screen has no hover. Removing works after the project disconnects, too. The
 * releases that shipped the work lead, above its pull requests.
 */
export function TaskGithubLinks({
  links,
  releases = [],
  unreleased = false,
  className,
}: {
  links: readonly TaskGithubLink[];
  releases?: readonly GithubRelease[];
  unreleased?: boolean;
  className?: string;
}) {
  const released = releases.length > 0 || unreleased;
  if (links.length === 0 && !released) return null;
  const groups = (['pr', 'issue'] as const)
    .map((kind) => ({ kind, items: links.filter((link) => link.kind === kind) }))
    .filter((group) => group.items.length > 0);
  return (
    <section aria-label="GitHub" className={cn('flex flex-col gap-3', className)}>
      {released && (
        <div className="flex flex-col gap-1.5">
          <h2 className="px-1 font-medium text-muted-foreground text-xs">Release</h2>
          <TaskReleases releases={releases} unreleased={unreleased} />
        </div>
      )}
      {groups.map((group) => (
        <div key={group.kind} className="flex flex-col gap-1">
          <h2 className="px-1 font-medium text-muted-foreground text-xs">
            {group.kind === 'pr' ? 'Pull requests' : 'Issues'}
          </h2>
          <ul className="flex flex-col gap-1">
            {group.items.map((link) => (
              <GithubLinkRow key={link.id} link={link} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function GithubLinkRow({ link }: { link: TaskGithubLink }) {
  return (
    <li
      data-github-link={githubReference(link)}
      className="relative rounded-xl bg-foreground/[0.04] transition-colors hover:bg-foreground/[0.07]"
    >
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${githubLinkLabel(link)}. Open on GitHub`}
        className="flex min-h-11 min-w-0 rounded-xl py-2 pr-11 pl-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
      >
        <GithubLinkSummary link={link} className="flex-1" />
      </a>
      <IconButton
        label={`Remove ${githubKindLabel[link.kind].toLowerCase()} ${githubReference(link)}`}
        className="absolute top-1.5 right-1.5 z-10 size-8 rounded-lg text-muted-foreground hover:bg-foreground/[0.1] hover:text-foreground after:absolute after:-inset-1.5 [&_svg]:size-4"
        onClick={() => {
          haptics.selection();
          // The row leaves at once, and returns if the server refuses.
          unlinkGithub(link.taskId, link.id).catch((error: unknown) => {
            toast(error instanceof GithubLinkError ? error.message : 'The link was not removed.');
          });
        }}
      >
        <X />
      </IconButton>
    </li>
  );
}
