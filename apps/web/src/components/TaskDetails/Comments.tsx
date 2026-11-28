import type { Comment } from '@throw/shared';
import { Bot, CloudUpload, Pencil, PenLine, Trash2, UserRound } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { LazyDescriptionEditor } from '@/components/DescriptionEditor/LazyDescriptionEditor';
import { Hint } from '@/components/Hint/Hint';
import { IconButton } from '@/components/IconButton/IconButton';
import { ariaShortcut, ShortcutKeys } from '@/components/KeyboardShortcuts/Keys';
import { Button } from '@/components/ui/button';
import { signedInUserId } from '@/lib/collections';
import { deleteComment, editComment } from '@/lib/comments';
import { haptics } from '@/lib/haptics';
import { animateSteadySpring, curves, springs, stopSteady } from '@/lib/motion';
import type { TimelineItem } from '@/lib/timeline';
import { cn } from '@/lib/utils';
import { CommentComposer } from './CommentComposer';
import { relativeTime, relativeTimeChange } from './history';
import { author, commentSurface, fullTime } from './timelineParts';

/** How far an arriving comment settles, as `Collapse`'s content does. */
const SETTLE = 10;
/** A leaving comment clears out quickly, so its room closes on an empty space. */
const leave = { duration: 0.16, ease: curves.enter.ease };

/** How long ago the server received it, kept current; the exact time is in its hint. */
function RelativeTime({ at }: { at: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const wait = relativeTimeChange(at, now);
    if (wait === null) return;
    const timer = setTimeout(() => setNow(new Date()), wait + 50);
    return () => clearTimeout(timer);
  }, [at, now]);
  return (
    <Hint label={`${fullTime(at)}, when it synced`} describe>
      <time dateTime={at} className="whitespace-nowrap">
        {relativeTime(at, now)}
      </time>
    </Hint>
  );
}

/** How long a swap keeps the pane scrolled to it: its spring, and a keyboard rising after it. */
const REVEAL_MS = 900;
const leaveEasing = `cubic-bezier(${curves.enter.ease.join(',')})`;

/**
 * How far the pane must scroll for `element`'s foot to clear whatever covers the pane's foot
 * (a phone's dock declares itself as the pane's bottom scroll padding; the keyboard shortens
 * the pane), without taking its head above the pane's top.
 */
function revealDistance(element: HTMLElement, area: HTMLElement) {
  const style = getComputedStyle(area);
  const pane = area.getBoundingClientRect();
  const top = pane.top + (Number.parseFloat(style.scrollPaddingTop) || 0) + 12;
  const bottom = pane.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0) - 12;
  const box = element.getBoundingClientRect();
  return Math.min(box.bottom - bottom, box.top - top);
}

const keyboardInset = () =>
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard')) || 0;

/**
 * How quickly a reveal takes up a sudden change, such as the dock's undo and redo appearing
 * over the pane's foot: settled within the swap's own spring.
 */
const REVEAL_EASE_MS = (springs.pane.visualDuration * 1000) / 4;

/**
 * Shows one of several contents, named by `swapKey`, on one surface (`className`) that
 * springs from the old content's height to the new one's: the new content fades in as a
 * snapshot of the old fades out over it, so the surface itself is seen to grow or shrink.
 * What shows first stays still. A swap to `reveal`ing content keeps it scrolled into view as
 * it grows and while a keyboard comes up under it. Typing hands the height straight back to
 * the content, so text written while the spring runs is never clipped.
 */
function Swap({
  swapKey,
  reveal = false,
  className,
  children,
}: {
  swapKey: string;
  reveal?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // The room's height while a swap springs it, written straight to the box so the frame
  // that swaps the content already holds the old height. Otherwise the content's own.
  const room = useMotionValue(0);
  const measured = useRef<number>(undefined);
  const springing = useRef(false);
  const [first] = useState(swapKey);
  const shown = useRef(swapKey);
  // The old content as it was painted, taken before React replaces it, to fade out on top.
  const ghost = useRef<HTMLElement | null>(null);
  const stopRevealing = useRef<() => void>(undefined);
  if (shown.current !== swapKey && !ghost.current && content.current && !reducedMotion)
    ghost.current = content.current.cloneNode(true) as HTMLElement;
  const settle = useCallback(() => {
    stopSteady(room);
    springing.current = false;
    box.current?.style.removeProperty('height');
    box.current?.style.removeProperty('overflow');
  }, [room]);
  // By painted frames: the editor swapped in takes a frame or two to mount, which would
  // otherwise come out of the start of the spring.
  const springTo = useCallback(
    (to: number) => {
      springing.current = true;
      if (box.current) {
        box.current.style.overflow = 'clip';
        box.current.style.height = `${room.get()}px`;
      }
      animateSteadySpring(room, to, springs.pane).then(settle);
    },
    [room, settle],
  );
  useLayoutEffect(() => {
    const element = content.current;
    // Only a swap measures here. Reading the layout on any other render (a tab switch above)
    // would lay out the pane before `Collapse` holds its height, and clamp the pane's scroll.
    if (!element || shown.current === swapKey) return;
    shown.current = swapKey;
    const old = ghost.current;
    ghost.current = null;
    const from = measured.current;
    const animate = !reducedMotion && from !== undefined;
    // The box holds the old height before the new content is measured: Firefox clamps the
    // pane's scroll at that layout, taking a shrink off it in one frame.
    if (animate && box.current) {
      // Picks up from where a spring still running has got to.
      if (!springing.current) room.jump(from);
      box.current.style.overflow = 'clip';
      box.current.style.height = `${room.get()}px`;
    }
    const to = element.offsetHeight;
    measured.current = to;
    if (!animate || Math.abs(from - to) < 1) settle();
    else springTo(to);
    if (old && box.current && typeof old.animate === 'function') {
      for (const node of [old, ...old.querySelectorAll('[id], [contenteditable]')]) {
        node.removeAttribute('id');
        node.removeAttribute('contenteditable');
      }
      old.inert = true;
      old.setAttribute('aria-hidden', 'true');
      old.dataset.swapGhost = '';
      Object.assign(old.style, { position: 'absolute', inset: '0 0 auto', pointerEvents: 'none' });
      box.current.append(old);
      const fading = old.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: leave.duration * 1000,
        easing: leaveEasing,
        fill: 'forwards',
      });
      fading.finished.then(
        () => old.remove(),
        () => old.remove(),
      );
    }
    stopRevealing.current?.();
    stopRevealing.current = undefined;
    if (!reveal || !box.current) return;
    const target = box.current;
    const area = target.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!area) return;
    // The editor's own caret keeping waits, so the two never pull the pane apart.
    area.dataset.revealing = '';
    const started = performance.now();
    let last = started;
    let keyboard = keyboardInset();
    let frame = requestAnimationFrame(function follow(now) {
      // A panel closing around it is on its way out, not to be scrolled to.
      if (target.closest('[inert]')) return stopRevealing.current?.();
      const by = revealDistance(target, area);
      // The keyboard is followed as it moves, as the page rides it in native apps; the rest
      // (the surface growing, toolbars appearing) is eased in rather than jumped to.
      const inset = keyboardInset();
      const along = Math.min(Math.max(by, 0), Math.max(inset - keyboard, 0));
      keyboard = inset;
      if (by > 0.5)
        area.scrollTop += along + (by - along) * (1 - Math.exp(-(now - last) / REVEAL_EASE_MS));
      last = now;
      if (now - started < REVEAL_MS || springing.current) frame = requestAnimationFrame(follow);
      else stopRevealing.current?.();
    });
    // The reader's own scroll ends it.
    const stop = () => stopRevealing.current?.();
    area.addEventListener('wheel', stop, { once: true, passive: true });
    area.addEventListener('touchstart', stop, { once: true, passive: true });
    stopRevealing.current = () => {
      cancelAnimationFrame(frame);
      delete area.dataset.revealing;
      area.removeEventListener('wheel', stop);
      area.removeEventListener('touchstart', stop);
      stopRevealing.current = undefined;
    };
  });
  useEffect(
    () =>
      room.on('change', (value) => {
        if (springing.current && box.current) box.current.style.height = `${value}px`;
      }),
    [room],
  );
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measured.current = element.offsetHeight;
      if (springing.current) springTo(measured.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [springTo]);
  useLayoutEffect(
    () => () => {
      settle();
      stopRevealing.current?.();
      for (const old of box.current?.querySelectorAll('[data-swap-ghost]') ?? []) old.remove();
    },
    [settle],
  );
  return (
    <div
      ref={box}
      // Once typing starts, the editor keeps its caret in view itself.
      onInputCapture={() => {
        settle();
        stopRevealing.current?.();
      }}
      className={cn('relative', className)}
    >
      <div ref={content} className="flow-root">
        <motion.div
          key={swapKey}
          initial={swapKey === first && shown.current === first ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reducedMotion ? curves.fade : curves.enter}
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}

function Avatar({ comment }: { comment: Comment }) {
  const own = comment.userId !== null && comment.userId === signedInUserId;
  const Icon = comment.viaTokenName ? Bot : UserRound;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5',
        own ? 'bg-brand/15 text-brand-link' : 'bg-foreground/[0.08] text-muted-foreground',
        comment.userId === null && 'opacity-60',
      )}
    >
      <Icon />
    </span>
  );
}

/**
 * One comment. Its author edits it in place: the text gives way to the editor on the same
 * card, and the card springs between their heights.
 */
const CommentCard = memo(function CommentCard({
  comment,
  pending,
}: {
  comment: Comment;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = comment.userId !== null && comment.userId === signedInUserId;
  const actions = own && !editing && !deleting;
  return (
    <article
      aria-label={`${author(comment.userId)} commented`}
      className={cn(
        commentSurface,
        'group/comment px-3.5 pt-2.5 pb-3 transition-shadow duration-200 sm:px-4',
        editing && 'focus-within:ring-ring/45',
      )}
    >
      <div className="flex min-h-7 items-center gap-2.5">
        <Avatar comment={comment} />
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-muted-foreground text-xs">
          <span className="font-medium text-[0.8125rem] text-foreground">
            {author(comment.userId)}
          </span>
          {comment.viaTokenName && (
            <span className="inline-flex min-w-0 max-w-full items-center rounded-full bg-foreground/[0.06] px-2 py-px font-medium text-[0.6875rem] leading-4">
              <span className="truncate">via {comment.viaTokenName}</span>
            </span>
          )}
          <span aria-hidden className="text-muted-foreground/60">
            ·
          </span>
          {pending ? (
            <span className="inline-flex items-center gap-1">
              <CloudUpload aria-hidden className="size-3" />
              Pending sync
            </span>
          ) : (
            <RelativeTime at={comment.createdAt!} />
          )}
          {comment.editedAt && <span>· Edited</span>}
        </p>
        {actions && (
          <span
            className={cn(
              // A mouse finds them on the comment it points at; a finger always sees them, at a
              // size it can hit.
              '-my-1 -mr-1.5 flex shrink-0 transition-opacity duration-150 pointer-coarse:-my-2',
              'pointer-fine:opacity-0 pointer-fine:group-hover/comment:opacity-100 pointer-fine:group-focus-within/comment:opacity-100',
            )}
          >
            <IconButton
              label="Edit comment"
              className="text-muted-foreground hover:text-foreground pointer-coarse:size-10 [&_svg]:size-3.5"
              onClick={() => setEditing(true)}
            >
              <Pencil />
            </IconButton>
            <IconButton
              label="Delete comment"
              className="text-muted-foreground hover:text-destructive pointer-coarse:size-10 [&_svg]:size-3.5"
              onClick={() => setDeleting(true)}
            >
              <Trash2 />
            </IconButton>
          </span>
        )}
      </div>
      <Swap swapKey={editing ? 'edit' : 'view'} reveal={editing}>
        <div className="pt-1.5">
          {editing ? (
            <CommentComposer
              bare
              initialContent={comment.body}
              taskId={comment.taskId}
              onSave={(body) => {
                editComment(comment.id, body);
                haptics.success();
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="comment-body">
              <LazyDescriptionEditor
                key={JSON.stringify(comment.body)}
                initialContent={comment.body}
                referencesFor={comment.taskId}
              />
            </div>
          )}
        </div>
      </Swap>
      {own && (
        <Swap swapKey={deleting ? 'confirm' : 'none'} reveal={deleting}>
          {deleting && (
            <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1 border-foreground/[0.08] border-t pt-2">
              <p className="min-h-8 basis-full content-center text-muted-foreground text-xs">
                Delete this comment?
              </p>
              <Button variant="ghost" size="sm" onClick={() => setDeleting(false)}>
                Keep comment
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  try {
                    deleteComment(comment.id);
                    haptics.warning();
                  } catch {
                    setError('Could not delete this comment. Try again.');
                  }
                }}
              >
                Delete comment
              </Button>
            </div>
          )}
        </Swap>
      )}
      {error && (
        <p role="alert" className="mt-1 text-destructive text-sm">
          {error}
        </p>
      )}
    </article>
  );
});

/**
 * A comment's place in the list. One posted, synced in or deleted while the list is showing
 * opens or folds its room as its card fades; those already there when it opens stay still.
 */
function CommentItem({
  id,
  arrive,
  children,
}: {
  id: string;
  arrive: boolean;
  children: ReactNode;
}) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  const [moving, setMoving] = useState(arrive);
  if (!present && !moving) setMoving(true);
  return (
    <motion.li
      id={`history-${id}`}
      tabIndex={-1}
      inert={!present}
      initial={
        arrive ? (reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: SETTLE }) : false
      }
      animate={{
        height: 'auto',
        opacity: 1,
        y: 0,
        transition: reducedMotion
          ? curves.fade
          : { height: springs.pane, default: { ...curves.enter, delay: 0.06 } },
      }}
      exit={
        reducedMotion
          ? { opacity: 0, transition: curves.fade }
          : {
              height: 0,
              opacity: 0,
              y: SETTLE / 2,
              transition: { height: { ...curves.fold, delay: 0.1 }, default: leave },
            }
      }
      onAnimationComplete={() => present && setMoving(false)}
      // Clipped only while its room changes, so a focus ring shows at rest.
      style={{ overflow: moving ? 'clip' : undefined }}
      className="scroll-m-6 rounded-2xl outline-none [overflow-wrap:anywhere] focus:ring-2 focus:ring-ring/60"
    >
      {/* The gap below sits inside the item, so it opens and folds with the comment. */}
      <div className="pb-2">{children}</div>
    </motion.li>
  );
}

type CommentEntry = Extract<TimelineItem, { type: 'comment' }>;

/** The task's comments in server order. */
export function CommentList({ comments, loading }: { comments: CommentEntry[]; loading: boolean }) {
  // Comments already on the device appear with the list; only later ones arrive.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!loading) setSettled(true);
  }, [loading]);
  return (
    <ol>
      <AnimatePresence initial={false}>
        {comments.map((item) => (
          <CommentItem key={item.id} id={item.id} arrive={settled}>
            <CommentCard comment={item.comment} pending={item.pending} />
          </CommentItem>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/**
 * The prompt to write a comment, which opens into the composer in its place; posting or
 * cancelling folds it back.
 */
export function CommentPrompt({
  composing,
  hasDraft,
  onCompose,
  composer,
}: {
  composing: boolean;
  hasDraft: boolean;
  onCompose: () => void;
  /** A `bare` composer: the prompt's surface is its surface, so the one card grows into it. */
  composer: ReactNode;
}) {
  return (
    <Swap
      swapKey={composing ? 'compose' : 'prompt'}
      reveal={composing}
      className={cn(
        commentSurface,
        'transition-shadow duration-200',
        composing && 'focus-within:ring-ring/45',
      )}
    >
      {composing ? (
        <div className="px-3.5 pt-3 pb-2 sm:px-4">{composer}</div>
      ) : (
        <button
          type="button"
          aria-keyshortcuts={ariaShortcut('taskComment')}
          className="flex min-h-12 w-full items-center gap-2.5 rounded-2xl px-3.5 text-left text-foreground/80 text-sm outline-none transition-colors hover:bg-foreground/[0.035] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-inset sm:px-4"
          onClick={onCompose}
        >
          <span
            aria-hidden
            className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] [&_svg]:size-3.5"
          >
            <PenLine />
            {hasDraft && (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand" />
            )}
          </span>
          {hasDraft ? 'Resume comment draft' : 'Write a comment…'}
          {/* The open task's key for this, where there is a keyboard to press it on. */}
          <ShortcutKeys
            id="taskComment"
            spoken={false}
            className="ml-auto hidden pointer-fine:inline-flex"
          />
        </button>
      )}
    </Swap>
  );
}
