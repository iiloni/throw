import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useShell } from '@/components/AppShell/shell';
import { useBoardToggles } from '@/components/Board/BoardSettingsPanel';
import { UpdateDot } from '@/components/UpdateDot/UpdateDot';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { SETTINGS_TABS, useAdminAccess } from '@/lib/settings';
import { UPDATE_READY_DESCRIPTION, useUpdateReady } from '@/lib/updateReady';

/**
 * A right click on the rail's Settings: the board on screen's display toggles, then each
 * Settings page to go straight to. Content mounts only while open, so the rail reads none of it.
 */
export function SettingsContextMenu({ children }: { children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label="Quick settings" data-settings-menu="">
        <SettingsMenuContent />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SettingsMenuContent() {
  const shell = useShell();
  const navigate = useNavigate();
  const admin = useAdminAccess();
  const updateReady = useUpdateReady();
  return (
    <>
      {shell.board && <BoardToggles />}
      <ContextMenuGroup>
        <ContextMenuLabel>Settings</ContextMenuLabel>
        {SETTINGS_TABS.filter((tab) => tab.section === 'User' || admin).map(
          ({ path, label, icon: Icon }) => (
            <ContextMenuItem
              key={path}
              aria-description={
                path === '/settings/update' && updateReady ? UPDATE_READY_DESCRIPTION : undefined
              }
              onSelect={() => void navigate({ to: path })}
            >
              <Icon aria-hidden />
              {label}
              {path === '/settings/update' && <UpdateDot className="ml-auto" />}
            </ContextMenuItem>
          ),
        )}
      </ContextMenuGroup>
    </>
  );
}

function BoardToggles() {
  const toggles = useBoardToggles();
  return (
    <>
      <ContextMenuGroup>
        <ContextMenuLabel>Board display</ContextMenuLabel>
        {toggles.map(({ key, label, checked, onChange }) => (
          <ContextMenuCheckboxItem
            key={key}
            checked={checked}
            onCheckedChange={onChange}
            // A display toggle shows its effect on the board behind, so the menu stays for the next.
            onSelect={(event) => event.preventDefault()}
          >
            {label}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuGroup>
      <ContextMenuSeparator />
    </>
  );
}
