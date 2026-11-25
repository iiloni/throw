import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  EditorControls,
  FormattingState,
} from '@/components/DescriptionEditor/editorControls';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HistoryToolbar, useHasHistory } from './HistoryToolbar';

function fakeEditor() {
  let state: FormattingState = {
    styles: { bold: false, italic: false, underline: false, strike: false },
    block: 'paragraph',
    canIndent: false,
    canOutdent: false,
    canUndo: false,
    canRedo: false,
  };
  const listeners = new Set<() => void>();
  const controls: EditorControls = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggleStyle: vi.fn(),
    toggleBlock: vi.fn(),
    insertSlash: vi.fn(),
    indent: vi.fn(),
    outdent: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
  function history(canUndo: boolean, canRedo: boolean) {
    act(() => {
      state = { ...state, canUndo, canRedo };
      for (const listener of listeners) listener();
    });
  }
  function moveCaret(block: string) {
    act(() => {
      state = { ...state, block };
      for (const listener of listeners) listener();
    });
  }
  return { controls, history, moveCaret };
}

describe('HistoryToolbar', () => {
  it('appears on the first edit and follows the undo and redo availability', () => {
    const { controls, history } = fakeEditor();
    render(
      <TooltipProvider>
        <HistoryToolbar controls={controls} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    history(true, false);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();
    const pointer = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    fireEvent(undo, pointer);
    expect(pointer.defaultPrevented).toBe(true);
    fireEvent.click(undo);
    expect(controls.undo).toHaveBeenCalledOnce();

    history(false, true);
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    fireEvent.click(redo);
    expect(controls.redo).toHaveBeenCalledOnce();
  });

  it('stays away without an editor or while hidden', () => {
    const { controls, history } = fakeEditor();
    history(true, true);
    const { rerender } = render(
      <TooltipProvider>
        <HistoryToolbar controls={null} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <HistoryToolbar controls={controls} floating hidden />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <HistoryToolbar controls={controls} floating />
      </TooltipProvider>,
    );
    expect(screen.getByRole('toolbar', { name: 'Undo and redo' })).toBeInTheDocument();
  });
});

describe('useHasHistory', () => {
  it('answers only whether there is history, not every move of the caret', () => {
    const { controls, history, moveCaret } = fakeEditor();
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useHasHistory(controls);
    });
    expect(result.current).toBe(false);
    const before = renders;
    moveCaret('heading');
    expect(renders).toBe(before);
    history(true, false);
    expect(result.current).toBe(true);
    history(false, false);
    expect(result.current).toBe(false);
  });
});
