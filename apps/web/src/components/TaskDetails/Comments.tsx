import type { Comment } from '@throw/shared';
import { Bot, CloudUpload, Pencil, PenLine, Trash2, UserRound } from 'lucide-react';
import {
  AnimatePresence,
  type AnimationPlaybackControls,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
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
import { Button } from '@/components/ui/button';
import { signedInUserId } from '@/lib/collections';
import { deleteComment, editComment } from '@/lib/comments';
import { haptics } from '@/lib/haptics';
import { curves, springs } from '@/lib/motion';
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

/**
 * Shows one of several contents, named by `swapKey`. A swap springs the room from the old
 * content's height to the new one's, following content that lays out late (the editor loading
 * in), and fades the new content in; what shows first stays still. Typing hands the height
 * straight back to the content, so text written while the spring runs is never clipped or
 * held out of a scroll's reach.
 */
function Swap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const content = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number | 'auto'>('auto');
  const overflow = useTransform(height, (value) => (value === 'auto' ? 'visible' : 'clip'));
  const measured = useRef<number>(undefined);
  const spring = useRef<AnimationPlaybackControls | null>(null);
  const [first] = useState(swapKey);
  const shown = useRef(swapKey);
  const settle = useCallback(() => {
    spring.current?.stop();
    spring.current = null;
    height.jump('auto');
  }, [height]);
  const springTo = useCallback(
    (to: number) => {
      spring.current?.stop();
      spring.current = animate(height, to, { ...springs.pane, onComplete: settle });
    },
    [height, settle],
  );
  useLayoutEffect(() => {
    const element = content.current;
    // Only a swap measures here. Reading the layout on any other render (a tab switch above)
    // would lay out the pane before `Collapse` holds its height, and clamp the pane's scroll.
    if (!element || shown.current === swapKey) return;
    shown.current = swapKey;
    const from = measured.current;
    const to = element.offsetHeight;
    measured.current = to;
    if (reducedMotion || from === undefined || Math.abs(from - to) < 1) return settle();
    // Picks up from where a spring still running has got to.
    if (height.get() === 'auto') height.jump(from);
    springTo(to);
  });
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measured.current = element.offsetHeight;
      if (spring.current) springTo(measured.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [springTo]);
  useLayoutEffect(() => settle, [settle]);
  return (
    <motion.div style={{ height, overflow }} onInputCapture={settle}>
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
    </motion.div>
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
      <Swap swapKey={editing ? 'edit' : 'view'}>
        <div className="pt-1.5">
          {editing ? (
            <CommentComposer
              bare
              initialContent={comment.body}
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
              />
            </div>
          )}
        </div>
      </Swap>
      {own && (
        <Swap swapKey={deleting ? 'confirm' : 'none'}>
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
  composer: ReactNode;
}) {
  return (
    <Swap swapKey={composing ? 'compose' : 'prompt'}>
      {composing ? (
        composer
      ) : (
        <button
          type="button"
          className={cn(
            commentSurface,
            'flex min-h-12 w-full items-center gap-2.5 px-3.5 text-left text-muted-foreground text-sm outline-none transition-colors hover:bg-foreground/[0.065] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60 sm:px-4',
          )}
          onClick={onCompose}
        >
          <span
            aria-hidden
            className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] [&_svg]:size-3.5"
          >
            <PenLine />
            {hasDraft && (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand" />
            )}
          </span>
          {hasDraft ? 'Resume comment draft' : 'Write a comment…'}
        </button>
      )}
    </Swap>
  );
}
