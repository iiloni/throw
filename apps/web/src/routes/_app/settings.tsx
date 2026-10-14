import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { BoardSettingsControls } from '@/components/Board/BoardSettingsPanel';
import { Button } from '@/components/ui/button';
import { authClient, clearAuthToken, getSignedInUser } from '@/lib/auth';
import { clearLocalData } from '@/lib/collections';
import { useSyncStatus } from '@/lib/syncStatus';
import { useThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/settings')({ component: Settings });
function Settings() {
  const user = getSignedInUser();
  const { pending } = useSyncStatus();
  const [leaving, setLeaving] = useState(false);
  const [theme, setTheme] = useThemePreference();
  async function signOut() {
    if (
      pending > 0 &&
      !window.confirm(
        `${pending} unsaved ${pending === 1 ? 'change has' : 'changes have'} not reached the server and will be lost. Sign out anyway?`,
      )
    )
      return;
    setLeaving(true);
    await authClient.signOut().catch(() => undefined);
    await clearLocalData();
    clearAuthToken();
    window.location.assign('/login');
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 px-5 py-8 md:px-8">
      <fieldset>
        <legend className="mb-3 font-semibold">Appearance</legend>
        <div className="flex gap-2">
          {(['system', 'light', 'dark'] as const).map((value) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={theme === value}
              className={cn('capitalize', theme === value && 'bg-accent')}
              onClick={() => setTheme(value)}
            >
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
      </fieldset>
      <section className="border-t pt-6">
        <h2 className="mb-3 font-semibold">Board</h2>
        <BoardSettingsControls includeTheme={false} />
      </section>
      <section className="border-t pt-6">
        <h2 className="font-semibold">Account</h2>
        <p className="mt-2 break-all text-muted-foreground text-sm">{user?.name || user?.email}</p>
        <Button className="mt-4" variant="outline" disabled={leaving} onClick={signOut}>
          Sign out
        </Button>
      </section>
    </div>
  );
}
