import {
  compareStatuses,
  type GithubConnection,
  type GithubStatusTrigger,
  type Status,
} from '@throw/shared';
import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleCheck,
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { type ReactNode, useContext, useId, useRef, useState } from 'react';
import { StatusGlyph } from '@/components/Board/glyphs';
import { byCategory } from '@/components/Board/model';
import { ManagementSurface } from '@/components/ManagementSurface/ManagementSurface';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { StatusOptions } from '@/components/TaskDetails/TaskPickers';
import { ScrollBox } from '@/components/ui/scroll-area';
import { ApiError } from '@/lib/api';
import {
  GithubConnectionContext,
  githubStatusRules,
  saveGithubStatusRules,
} from '@/lib/githubSettings';
import { haptics } from '@/lib/haptics';
import { useDesktop } from '@/lib/media';
import { cn } from '@/lib/utils';

type Rule = {
  trigger: GithubStatusTrigger;
  label: string;
  description: string;
  icon: LucideIcon;
};

/** ADR 0017's rules, in the order a pull request and an issue live through them. */
const RULES: readonly Rule[] = [
  {
    trigger: 'prDraftOpened',
    label: 'Draft pull request opened',
    description: 'A linked pull request opens or reopens as a draft, or goes back to draft.',
    icon: GitPullRequestDraft,
  },
  {
    trigger: 'prReadyForReview',
    label: 'Ready for review',
    description: 'A linked pull request opens ready for review, or leaves draft.',
    icon: GitPullRequestArrow,
  },
  {
    trigger: 'prMerged',
    label: 'Pull request merged',
    description: 'The task’s last open pull request closes, and one of them merged.',
    icon: GitMerge,
  },
  {
    trigger: 'prClosed',
    label: 'Pull request closed',
    description: 'The task’s last open pull request closes without any of them merging.',
    icon: GitPullRequestClosed,
  },
  {
    trigger: 'issueClosed',
    label: 'Issue closed',
    description: 'The task’s last open linked issue closes.',
    icon: CircleCheck,
  },
];

const OFF = 'off';

/**
 * The project's GitHub status rules (ADR 0017): each event's target status, or off. A pick
 * shows at once and saves in the order made; a failed save returns the rule to what the
 * server holds and says so. Absent on a server older than the rules.
 */
export function GithubStatusRules({
  connection,
  statuses,
}: {
  connection: GithubConnection;
  /** The project's statuses, or null while they first load. */
  statuses: readonly Status[] | null;
}) {
  const settings = useContext(GithubConnectionContext)!;
  const rules = githubStatusRules(connection);
  const [pending, setPending] = useState<Partial<Record<GithubStatusTrigger, string | null>>>({});
  const [error, setError] = useState('');
  // One save at a time, so each answer holds every rule saved before it.
  const queue = useRef(Promise.resolve());
  if (!rules) return null;

  const shownOf = (trigger: GithubStatusTrigger) =>
    trigger in pending ? (pending[trigger] ?? null) : rules[trigger];

  function choose(trigger: GithubStatusTrigger, statusId: string | null) {
    if (statusId === shownOf(trigger)) return;
    haptics.selection();
    setError('');
    setPending((current) => ({ ...current, [trigger]: statusId }));
    const settle = () =>
      setPending((current) => {
        if (current[trigger] !== statusId) return current;
        const { [trigger]: _, ...rest } = current;
        return rest;
      });
    queue.current = queue.current.then(async () => {
      try {
        settings.changed(
          await saveGithubStatusRules(connection.projectId, { [trigger]: statusId }),
        );
      } catch (failure) {
        setError(
          failure instanceof ApiError && failure.status === 400
            ? 'That status is no longer in this project. Choose another.'
            : 'Could not save the rule. Check your connection and try again.',
        );
        // The server may have turned the rule off meanwhile, as deleting a status does.
        settings.refresh();
      } finally {
        settle();
      }
    });
  }

  const sorted = statuses ? [...statuses].sort(compareStatuses) : null;
  return (
    <SettingsSection
      title="Status rules"
      description={
        connection.enabled
          ? 'When GitHub reports a change to a linked pull request or issue, its task moves to the status chosen here. Each move shows in the task’s history as GitHub’s.'
          : 'Deliveries are off, so no rule moves a task until they are turned back on.'
      }
    >
      {sorted === null ? (
        <p role="status" className="px-4 py-5 text-muted-foreground text-sm">
          Loading statuses…
        </p>
      ) : (
        RULES.map((rule) => {
          const shown = shownOf(rule.trigger);
          return (
            <RuleRow
              key={rule.trigger}
              rule={rule}
              // A rule naming a status this device no longer has reads as off, as the server
              // turns it off when the status is deleted.
              status={sorted.find((status) => status.id === shown) ?? null}
              statuses={sorted}
              saving={rule.trigger in pending}
              onChange={(statusId) => choose(rule.trigger, statusId)}
            />
          );
        })
      )}
      {error && (
        <p role="alert" className="px-4 py-3 text-destructive text-sm">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}

function Value({ status }: { status: Status | null }) {
  return status ? (
    <>
      <StatusGlyph category={status.category} color={status.color} className="size-4" />
      <span className="min-w-0 truncate">{status.name}</span>
    </>
  ) : (
    <span className="text-muted-foreground">Off</span>
  );
}

function RuleRow({
  rule,
  status,
  statuses,
  saving,
  onChange,
}: {
  rule: Rule;
  status: Status | null;
  statuses: readonly Status[];
  saving: boolean;
  onChange: (statusId: string | null) => void;
}) {
  const desktop = useDesktop();
  const labelId = useId();
  const valueId = useId();
  const [picking, setPicking] = useState(false);
  const Icon = rule.icon;
  const text = (
    <span className="min-w-0 flex-1">
      <span id={labelId} className="block font-medium">
        {rule.label}
      </span>
      <span className="block text-muted-foreground text-sm">{rule.description}</span>
    </span>
  );
  const value = (
    <span
      id={valueId}
      className={cn(
        'flex min-w-0 items-center gap-2 text-sm transition-opacity duration-200',
        saving && 'opacity-60',
      )}
    >
      <Value status={status} />
    </span>
  );

  if (desktop)
    return (
      <div className="flex min-h-14 items-center gap-3 px-4 py-3" aria-busy={saving || undefined}>
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        {text}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            aria-labelledby={`${labelId} ${valueId}`}
            className="flex h-10 w-44 shrink-0 items-center gap-2 rounded-xl bg-foreground/[0.06] px-3 text-left outline-none transition-colors duration-200 hover:bg-foreground/[0.09] focus-visible:ring-[3px] focus-visible:ring-ring/60 data-[state=open]:bg-foreground/[0.09]"
          >
            <span className="flex min-w-0 flex-1">{value}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              collisionPadding={12}
              aria-label={rule.label}
              className="shell-menu glass-thick z-50 flex w-56 flex-col overflow-hidden rounded-3xl"
            >
              <ScrollBox
                className="max-h-[min(70dvh,32rem)] [--scrollbar-inset:1rem]"
                viewportClassName="p-2"
              >
                <DropdownMenu.RadioGroup
                  value={status?.id ?? OFF}
                  onValueChange={(next) => onChange(next === OFF ? null : next)}
                >
                  <MenuItem value={OFF}>
                    <span className="min-w-0 flex-1 truncate">Off</span>
                  </MenuItem>
                  {byCategory(statuses)
                    .filter((group) => group.statuses.length > 0)
                    .map((group) => (
                      <DropdownMenu.Group key={group.name}>
                        <DropdownMenu.Label className="px-3 pt-2 pb-1 text-muted-foreground text-xs">
                          {group.name}
                        </DropdownMenu.Label>
                        {group.statuses.map((option) => (
                          <MenuItem key={option.id} value={option.id}>
                            <StatusGlyph
                              category={option.category}
                              color={option.color}
                              className="size-4"
                            />
                            <span className="min-w-0 flex-1 truncate">{option.name}</span>
                          </MenuItem>
                        ))}
                      </DropdownMenu.Group>
                    ))}
                </DropdownMenu.RadioGroup>
              </ScrollBox>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    );

  // A phone picks in the drawer (ADR 0009); the whole row opens it.
  return (
    <>
      <button
        type="button"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="dialog"
        aria-busy={saving || undefined}
        onClick={() => {
          haptics.toggle();
          setPicking(true);
        }}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-200 first:rounded-t-2xl last:rounded-b-2xl active:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:ring-inset"
      >
        <Icon className="size-5 shrink-0 self-start text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          {text}
          {value}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <ManagementSurface open={picking} title={rule.label} onClose={() => setPicking(false)} fit>
        <p className="px-1 pb-3 text-muted-foreground text-sm">{rule.description}</p>
        <div className="-mx-3">
          <StatusOptions
            none="Off"
            value={status?.id ?? ''}
            statuses={[...statuses]}
            onChange={(statusId) => {
              onChange(statusId || null);
              setPicking(false);
            }}
          />
        </div>
      </ManagementSurface>
    </>
  );
}

function MenuItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <DropdownMenu.RadioItem
      value={value}
      className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent"
    >
      {children}
      <DropdownMenu.ItemIndicator>
        <Check aria-hidden className="size-4" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}
