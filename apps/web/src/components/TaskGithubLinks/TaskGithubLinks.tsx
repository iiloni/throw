import type { TaskGithubLink } from '@throw/shared';
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

/**
 * A task's pull requests and issues, as its relations are listed: one row per item that opens
 * it on GitHub, kept current as webhooks arrive, with a remove button that is always shown,
 * since a touch screen has no hover. Removing works after the project disconnects, too.
 */
export function TaskGithubLinks({
  links,
  className,
}: {
  links: readonly TaskGithubLink[];
  className?: string;
}) {
  if (links.length === 0) return null;
  const groups = (['pr', 'issue'] as const)
    .map((kind) => ({ kind, items: links.filter((link) => link.kind === kind) }))
    .filter((group) => group.items.length > 0);
  return (
    <section aria-label="GitHub" className={cn('flex flex-col gap-3', className)}>
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
