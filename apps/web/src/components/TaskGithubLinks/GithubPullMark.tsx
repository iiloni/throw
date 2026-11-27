import { Capacitor } from '@capacitor/core';
import type { TaskGithubLink } from '@throw/shared';
import { ArrowUpRight } from 'lucide-react';
import { HoverCard } from 'radix-ui';
import { useState } from 'react';
import { drag } from '@/components/Board/drag';
import { githubLinkLabel, githubStateLabel, githubTone } from '@/lib/githubLinks';
import { useMedia } from '@/lib/media';
import { cn } from '@/lib/utils';
import { GithubLinkSummary, GithubStateIcon } from './TaskGithubLinks';

/** A mouse or trackpad that hovers: the only pointer the preview opens for. */
const HOVER_QUERY = '(hover: hover) and (pointer: fine)';

/** What the mark says aloud, its primary pull request first. */
export function pullMarkLabel(pulls: readonly TaskGithubLink[]) {
  const [primary] = pulls;
  if (!primary) return '';
  const failing = primary.checksSummary?.state === 'failing' ? ', checks failing' : '';
  const first = `pull request #${primary.number}, ${githubStateLabel[primary.state].toLowerCase()}${failing}`;
  return pulls.length === 1
    ? first.charAt(0).toUpperCase() + first.slice(1)
    : `${pulls.length} pull requests, first ${first}`;
}

/**
 * A board card's quiet mark for its pull requests, as restrained as the blocked mark: the
 * most relevant one's number (open work first, `pullRequestsByTask`), tinted by its state,
 * with a count of any others.
 *
 * With a mouse it is a link to that pull request, and lingering on it (or focusing it) opens
 * a glass preview of each with its review and checks. It takes no part in the card's press,
 * so it never starts a drag or opens the task. A touch screen shows the mark alone: a tap or
 * long press there is the card's.
 */
export function GithubPullMark({
  pulls,
  interactive,
}: {
  pulls: readonly TaskGithubLink[];
  /** False for copies of a card, such as the one a drag carries. */
  interactive: boolean;
}) {
  const hovers = useMedia(HOVER_QUERY) && Capacitor.getPlatform() !== 'android';
  const dragging = drag.use() !== null;
  const [open, setOpen] = useState(false);
  const [primary] = pulls;
  if (!primary) return null;
  const label = pullMarkLabel(pulls);
  const face = (
    <>
      <GithubStateIcon link={primary} className="size-3 shrink-0" />
      <span>#{primary.number}</span>
      {pulls.length > 1 && <span className="text-foreground/45">+{pulls.length - 1}</span>}
    </>
  );
  const markClass =
    '-m-1 flex shrink-0 items-center gap-0.5 rounded-md p-1 font-medium text-tint-accent tabular-nums';
  if (!interactive || !hovers)
    return (
      <span
        role="img"
        aria-label={label}
        data-github-mark={primary.state}
        data-color={githubTone(primary)}
        className={markClass}
      >
        {face}
      </span>
    );
  return (
    <HoverCard.Root
      open={open && !dragging}
      onOpenChange={setOpen}
      openDelay={350}
      closeDelay={150}
    >
      <HoverCard.Trigger asChild>
        <a
          href={primary.url}
          target="_blank"
          rel="noopener noreferrer"
          data-no-drag=""
          data-github-mark={primary.state}
          data-color={githubTone(primary)}
          aria-label={`${label}. Open on GitHub`}
          // A card carried over the mark must not stop to preview it.
          onPointerEnter={(event) => {
            if (event.buttons) event.preventDefault();
          }}
          className={cn(
            markClass,
            'outline-none transition-colors hover:bg-tint focus-visible:ring-2 focus-visible:ring-ring/70',
          )}
        >
          {face}
        </a>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          data-no-drag=""
          data-github-preview=""
          aria-label="Pull requests"
          // Above the drawer, dialogs and the palette, as hints are.
          className={cn(
            'glass-thick z-[75] flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-0.5 rounded-2xl p-1.5 text-foreground',
            'fade-in-0 origin-(--radix-hover-card-content-transform-origin) animate-in duration-200 ease-(--ease-emphasized) motion-safe:zoom-in-95',
          )}
        >
          {pulls.map((pull) => (
            <a
              key={pull.id}
              href={pull.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${githubLinkLabel(pull)}. Open on GitHub`}
              className="group/pull relative flex min-w-0 rounded-xl px-2.5 py-2 pr-8 outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <GithubLinkSummary link={pull} className="flex-1" />
              <ArrowUpRight
                aria-hidden
                className="absolute top-2 right-2 size-3.5 text-muted-foreground transition-colors group-hover/pull:text-foreground"
              />
            </a>
          ))}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
