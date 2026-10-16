import { Capacitor } from '@capacitor/core';
import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Props = React.ComponentProps<typeof Button> & {
  /** Accessible name, also shown as the tooltip in browsers. */
  label: string;
  /** Docks go without: a tooltip left closing as the dock hides would take the next Escape. */
  tooltip?: boolean;
};

/** Icon-only button. Stops clicks from reaching a clickable card. */
export function IconButton({ label, className, onClick, tooltip = true, ...props }: Props) {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn('size-8 rounded-full', className)}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      {...props}
    />
  );

  if (!tooltip || Capacitor.getPlatform() === 'android') return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
