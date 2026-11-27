import { SideMenuExtension, SuggestionMenu } from '@blocknote/core/extensions';
import {
  DragHandleButton,
  type FloatingUIOptions,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
} from '@blocknote/react';

type Middleware = NonNullable<
  NonNullable<FloatingUIOptions['useFloatingOptions']>['middleware']
>[number];

/**
 * Catch's side menu, fitted to a task's card. The description's text lines up with the card's
 * title, so the block menu has only the card's padding to sit in: one handle (Add block moves
 * into its menu, as in Catch) centred in that gutter, where BlockNote's `+` and handle ran past
 * the card's edge and were clipped. Nested blocks share the gutter, and the handle sits beside
 * a block's first line rather than its middle.
 */
const placeInGutter: Middleware = {
  name: 'placeInGutter',
  fn({ x, y, elements, rects }) {
    const reference =
      elements.reference instanceof Element
        ? elements.reference
        : elements.reference.contextElement;
    if (!reference) return {};
    const block = reference.getBoundingClientRect();
    const group = reference.closest('.bn-editor > .bn-block-group')?.getBoundingClientRect();
    const start = group?.left ?? block.left;
    const edge = reference.closest('[data-slot="scroll-area-viewport"]')?.getBoundingClientRect();
    const gutter = edge ? start - edge.left : rects.floating.width;
    const inline = reference.querySelector('.bn-inline-content');
    let line = Math.min(block.height, rects.floating.height);
    let top = block.top;
    if (inline) {
      const bounds = inline.getBoundingClientRect();
      const height = Number.parseFloat(getComputedStyle(inline).lineHeight) || bounds.height;
      line = Math.min(height, bounds.height);
      top = bounds.top;
    }
    return {
      x: x - (block.left - start) - Math.max(0, (gutter - rects.floating.width) / 2),
      y: y + top - block.top + line / 2 - rects.floating.height / 2,
    };
  },
};

const sideMenuFloatingOptions: FloatingUIOptions = {
  useFloatingOptions: { middleware: [placeInGutter] },
};

export function DescriptionSideMenuController() {
  return (
    <SideMenuController
      sideMenu={DescriptionSideMenu}
      floatingUIOptions={sideMenuFloatingOptions}
    />
  );
}

function DescriptionSideMenu() {
  const dict = useDictionary();
  // No block colors: a description is text only, and its preview would drop them.
  return (
    <SideMenu>
      <DragHandleButton>
        <AddBlockItem />
        <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
        <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
        <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
      </DragHandleButton>
    </SideMenu>
  );
}

function AddBlockItem() {
  const Components = useComponentsContext();
  const dict = useDictionary();
  const editor = useBlockNoteEditor();
  const suggestionMenu = useExtension(SuggestionMenu);
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block });
  if (!Components || !block) return null;
  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => {
        const empty = Array.isArray(block.content) && block.content.length === 0;
        const target = empty
          ? block
          : editor.insertBlocks([{ type: 'paragraph' }], block, 'after')[0];
        if (!target) return;
        editor.setTextCursorPosition(target);
        // Closing the handle's menu restores focus; open suggestions after that finishes.
        requestAnimationFrame(() => suggestionMenu.openSuggestionMenu('/'));
      }}
    >
      {dict.side_menu.add_block_label}
    </Components.Generic.Menu.Item>
  );
}
