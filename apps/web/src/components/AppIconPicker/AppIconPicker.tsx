import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import {
  type AppIcon,
  appIconBase,
  appIconLabel,
  getNativeAppIconPreview,
  setNativeAppIcon,
  useAppIconPreference,
} from '@/lib/appIcon';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { useUpdates } from '@/lib/updates';
import { cn } from '@/lib/utils';

/**
 * Chooses this device's app icon on dev and preview builds, as Catch's General settings do.
 * It shows the chosen icon as installed: the launcher's own rendering on Android and the
 * install manifest's artwork on the web.
 */
export function AppIconPicker() {
  const { android } = useUpdates();
  const { icon: value, choices, setIcon } = useAppIconPreference();
  const [pending, setPending] = useState(false);
  const available = choices.length > 1;
  const [nativePreview, setNativePreview] = useState<{
    icon: AppIcon;
    attempt: number;
    src: string | null;
  } | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => {
    if (!android || !available) return;
    let stopped = false;
    void getNativeAppIconPreview(value).then(
      (src) => {
        if (!stopped) setNativePreview({ icon: value, attempt: previewAttempt, src });
      },
      () => {
        if (!stopped) setNativePreview({ icon: value, attempt: previewAttempt, src: null });
      },
    );
    return () => {
      stopped = true;
    };
  }, [android, available, value, previewAttempt]);
  if (!available) return null;
  const currentPreview =
    nativePreview?.icon === value && nativePreview.attempt === previewAttempt
      ? nativePreview
      : null;
  const previewSrc = android ? currentPreview?.src : `${appIconBase(value)}/pwa-512x512.png`;
  const previewFailed = android && currentPreview?.src === null;

  async function choose(icon: AppIcon) {
    if (icon === value || pending) return;
    haptics.selection();
    setPending(true);
    try {
      await setNativeAppIcon(icon);
      setIcon(icon);
    } catch {
      toast.error('Could not change the app icon. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsSection
      title="App icon"
      description={
        android ? undefined : 'Your installed web app may ask you to approve the new icon.'
      }
    >
      <div className="flex min-h-30 items-center justify-center px-4 pt-6 pb-4">
        {previewSrc ? (
          <img src={previewSrc} alt={`${appIconLabel(value)} app icon`} className="size-20" />
        ) : previewFailed ? (
          <div className="flex flex-col items-center gap-2 text-center text-sm">
            <p role="status">Could not load the app icon preview.</p>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/60"
              onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
            >
              Retry preview
            </button>
          </div>
        ) : (
          <div role="status" className="size-20 rounded-2xl bg-foreground/5">
            <span className="sr-only">Loading app icon preview…</span>
          </div>
        )}
      </div>
      <fieldset
        className={cn(
          'grid min-w-0 gap-1 p-1.5',
          choices.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
        )}
        disabled={pending}
      >
        <legend className="sr-only">App icon</legend>
        {choices.map((icon) => {
          const selected = value === icon;
          return (
            <button
              key={icon}
              type="button"
              aria-pressed={selected}
              onClick={() => void choose(icon)}
              className={cn(
                'relative rounded-xl py-2.5 font-medium text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/60 disabled:opacity-60',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="app-icon-indicator"
                  aria-hidden
                  className="absolute inset-0 rounded-xl bg-card shadow-sm"
                  transition={springs.snappy}
                />
              )}
              <span className="relative">{appIconLabel(icon)}</span>
            </button>
          );
        })}
      </fieldset>
    </SettingsSection>
  );
}
