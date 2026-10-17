import { useRef, useState } from 'react';
import { useShell } from '@/components/AppShell/shell';
import type { DrawerPage } from '@/components/Drawer/Drawer';
import { type Dismiss, usePaletteActions } from './actions';
import { CaptureContent } from './CaptureContent';
import type { PaletteMode } from './CommandPalette';
import { PhoneSearchContent, useSearch } from './SearchContent';

/**
 * Search and capture as pages of the phone's drawer (ADR 0009). The drawer draws the title
 * row and close, takes focus, Escape, Back and the pull down; `dismiss` lets Back and Escape
 * close an open project list before the page itself.
 */
export function usePalettePages({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (mode: PaletteMode) => void;
}): { pages: Record<PaletteMode, DrawerPage>; open: (mode: PaletteMode) => void } {
  const dismiss: Dismiss = useRef(null);
  const [seed, setSeed] = useState('');
  const page = { dismiss: () => dismiss.current?.() ?? false };
  const pages: Record<PaletteMode, DrawerPage> = {
    search: {
      ...page,
      key: 'search',
      title: 'Search',
      content: (
        <SearchPage
          dismiss={dismiss}
          onClose={onClose}
          // Search hands a title it has no project for to capture, which can choose one.
          onCaptureTitle={(title) => {
            setSeed(title);
            onOpen('capture');
          }}
        />
      ),
    },
    capture: {
      ...page,
      key: 'capture',
      title: 'New task',
      content: <CapturePage seed={seed} dismiss={dismiss} onClose={onClose} />,
    },
  };
  return {
    pages,
    open(mode) {
      setSeed('');
      onOpen(mode);
    },
  };
}

function usePageActions(onClose: () => void) {
  const shell = useShell();
  // The drawer returns focus to what opened the page; an opened task takes it from there.
  return usePaletteActions({ onClose, onOpenTask: shell.openTask, onAction: () => {} });
}

function SearchPage({
  dismiss,
  onClose,
  onCaptureTitle,
}: {
  dismiss: Dismiss;
  onClose: () => void;
  onCaptureTitle: (title: string) => void;
}) {
  const actions = usePageActions(onClose);
  const search = useSearch({ actions, dismiss, onCaptureTitle });
  return <PhoneSearchContent search={search} />;
}

function CapturePage({
  seed,
  dismiss,
  onClose,
}: {
  seed: string;
  dismiss: Dismiss;
  onClose: () => void;
}) {
  const actions = usePageActions(onClose);
  return <CaptureContent actions={actions} seed={seed} dismiss={dismiss} />;
}
