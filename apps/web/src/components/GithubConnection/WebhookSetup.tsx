import type { GithubConnection } from '@throw/shared';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';

/** What GitHub's webhook form asks for that Throw decides. */
export const CONTENT_TYPE = 'application/json';

/** The repository's own webhook settings on GitHub. */
export const githubHooksUrl = (repository: string, add = false) =>
  `https://github.com/${repository}/settings/hooks${add ? '/new' : ''}`;

/**
 * A value to paste into GitHub, read-only, with a copy button inside its field. Where the
 * clipboard is refused, the value is selected for copying by hand.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      haptics.success();
      setCopied(true);
    } catch {
      field.current?.focus();
      field.current?.select();
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      <div className="flex min-w-0 items-center rounded-xl bg-foreground/[0.06] focus-within:ring-[3px] focus-within:ring-ring/60">
        <input
          id={id}
          ref={field}
          readOnly
          value={value}
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 min-w-0 flex-1 truncate bg-transparent pl-3 font-mono text-[0.8125rem] outline-none"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 rounded-xl"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void copy()}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={copied ? 'copied' : 'copy'}
              className="flex"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              transition={springs.snappy}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            </motion.span>
          </AnimatePresence>
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? `${label} copied` : ''}
        </span>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] font-medium text-muted-foreground text-xs tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
        <p className="break-words text-sm">{title}</p>
        {children}
      </div>
    </li>
  );
}

function OpenOnGithub({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="secondary" className="min-h-11 self-start">
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ArrowUpRight aria-hidden />
      </a>
    </Button>
  );
}

/** What to enter in the repository's Settings → Webhooks → Add webhook, once. */
export function WebhookSetup({
  connection,
  secret,
  onDone,
}: {
  connection: GithubConnection;
  secret: string;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-5 pb-1">
      <ol className="flex flex-col gap-5">
        <Step
          n={1}
          title={`In ${connection.repository} on GitHub, open Settings, then Webhooks, and add a webhook.`}
        >
          <OpenOnGithub href={githubHooksUrl(connection.repository, true)}>
            Add webhook on GitHub
          </OpenOnGithub>
        </Step>
        <Step n={2} title="Paste these values.">
          <CopyField label="Payload URL" value={connection.webhookUrl} />
          <CopyField label="Content type" value={CONTENT_TYPE} />
          <CopyField label="Secret" value={secret} />
          <p className="text-muted-foreground text-xs">
            Throw shows this secret only once. Make a new one later if it is lost.
          </p>
        </Step>
        <Step n={3} title="Choose “Send me everything”, then save the webhook.">
          <p className="text-muted-foreground text-xs">
            GitHub sends a ping once it is saved, and it shows here as the last delivery. Throw
            ignores events it does not use.
          </p>
        </Step>
      </ol>
      <div className="flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** A new secret, shown once after it replaces the old one. */
export function NewSecret({
  connection,
  secret,
  onDone,
}: {
  connection: GithubConnection;
  secret: string;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 pb-1">
      <p className="text-muted-foreground text-sm">
        Paste it into the webhook’s Secret field on GitHub. Until then, GitHub’s deliveries are
        refused. Throw shows it only once.
      </p>
      <CopyField label="Secret" value={secret} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OpenOnGithub href={githubHooksUrl(connection.repository)}>Webhooks on GitHub</OpenOnGithub>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
