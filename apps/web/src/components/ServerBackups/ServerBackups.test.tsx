import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_BACKUP_SCHEDULE } from '@throw/shared';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { serverBackups, useServerBackups } from '@/lib/serverBackups';
import { ServerBackups } from './ServerBackups';

vi.mock('@/lib/serverBackups', () => ({
  useServerBackups: vi.fn(),
  serverBackups: {
    create: vi.fn().mockResolvedValue({}),
    saveSchedule: vi.fn().mockResolvedValue({}),
  },
}));
describe('backup settings', () => {
  it('shows the storage warning and starts a database backup', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useServerBackups).mockReturnValue({
      state: {
        status: 'ready',
        overview: {
          backups: [],
          destination: { freeBytes: 1000000, sameDiskAsData: true, persistent: true },
          schedule: DEFAULT_BACKUP_SCHEDULE,
          running: null,
          lastBackup: null,
          lastRestore: null,
        },
      },
      refresh,
      expectRestore: vi.fn(),
    });
    render(
      <TooltipProvider>
        <ServerBackups onAccessDenied={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/keep copies off this server/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }));
    expect(serverBackups.create).toHaveBeenCalledWith();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
