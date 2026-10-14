import { Check } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { StatusGlyph } from './glyphs';
import { CATEGORIES, type Category, type Project } from './model';

export const CATEGORY_NAMES: Record<Category, string> = {
  backlog: 'Backlog',
  active: 'Active',
  done: 'Done',
  cancelled: 'Cancelled',
};

/** A menu of the project's statuses, grouped by category. */
export function StatusMenu({
  project,
  value,
  onSelect,
  children,
}: {
  project: Project;
  value?: string;
  onSelect: (statusId: string) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="shell-menu glass-thick z-50 max-h-[min(70dvh,32rem)] w-56 overflow-y-auto rounded-3xl p-2"
        >
          {CATEGORIES.map((category) => (
            <DropdownMenu.Group key={category}>
              <DropdownMenu.Label className="px-3 pt-2 pb-1 text-muted-foreground text-xs">
                {CATEGORY_NAMES[category]}
              </DropdownMenu.Label>
              {project.statuses
                .filter((status) => status.category === category)
                .map((status) => (
                  <DropdownMenu.Item
                    key={status.id}
                    onSelect={() => onSelect(status.id)}
                    className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm outline-none data-[highlighted]:bg-accent"
                  >
                    <StatusGlyph category={status.category} />
                    <span className="min-w-0 flex-1 truncate">{status.name}</span>
                    {status.id === value && <Check aria-hidden className="size-4" />}
                  </DropdownMenu.Item>
                ))}
            </DropdownMenu.Group>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
