import type { Color } from '@throw/shared';
import { useState } from 'react';
import { PROJECT_ICON_LABELS, ProjectIcon } from '@/components/ProjectIcon/ProjectIcon';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** The project icons to choose from, found by name and tinted in the project's colour. */
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
      <div className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto p-1" data-color={color}>
        {!query && (
          <button
            type="button"
            aria-label="Default icon"
            aria-pressed={value === null}
            onClick={() => onChange(null)}
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
            <button
              key={icon}
              type="button"
              aria-label={`${label} icon`}
              title={label}
              aria-pressed={value === icon}
              onClick={() => onChange(icon)}
              className={cn(
                'flex size-10 items-center justify-center rounded-xl outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring',
                value === icon && 'bg-tint text-tint-accent',
              )}
            >
              <ProjectIcon name={icon} className="size-5" />
            </button>
          ))}
      </div>
    </fieldset>
  );
}
