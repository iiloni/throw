import type { Color } from '@throw/shared';
import { useState } from 'react';
import { Hint } from '@/components/Hint/Hint';
import { PROJECT_ICON_LABELS, ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { Input } from '@/components/ui/input';
import { ScrollBox } from '@/components/ui/scroll-area';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

/** The project icons to choose from, found by name and tinted in the project's color. */
export function ProjectIconPicker({
  value,
  color,
  onChange,
  className,
}: {
  value: string | null;
  color: Color;
  onChange: (icon: string | null) => void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  function pick(icon: string | null) {
    if (icon !== value) haptics.selection();
    onChange(icon);
  }
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="mb-2 font-medium text-sm">Project icon</legend>
      <Input
        aria-label="Find an icon"
        placeholder="Find an icon"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="mb-2"
      />
      <ScrollBox className="max-h-40 [--scrollbar-inset:0.25rem]" viewportClassName="p-1">
        <div className="grid grid-cols-6 gap-1" data-color={color}>
          {!query && (
            <button
              type="button"
              aria-label="Default icon"
              aria-pressed={value === null}
              onClick={() => pick(null)}
              className={cn(
                'flex size-10 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring',
                value === null && 'bg-tint text-tint-accent',
              )}
            >
              <ProjectIcon className="size-5" />
            </button>
          )}
          {Object.entries(PROJECT_ICON_LABELS)
            .filter(([, label]) => label.toLowerCase().includes(query.toLowerCase()))
            .map(([icon, label]) => (
              <Hint key={icon} label={label}>
                <button
                  type="button"
                  aria-label={`${label} icon`}
                  aria-pressed={value === icon}
                  onClick={() => pick(icon)}
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
                    value === icon && 'bg-tint text-tint-accent',
                  )}
                >
                  <ProjectIcon name={icon} className="size-5" />
                </button>
              </Hint>
            ))}
        </div>
      </ScrollBox>
    </fieldset>
  );
}
