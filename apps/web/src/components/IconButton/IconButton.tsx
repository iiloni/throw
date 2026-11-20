import type * as React from 'react';
import { Hint, type HintSide } from '@/components/Hint/Hint';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = React.ComponentProps<typeof Button> & {
  /** Accessible name, also shown as the tooltip in browsers. */
  label: string;
  /** Docks go without: a tooltip left open as the dock hides would take the next Escape. */
  tooltip?: boolean;
  tooltipSide?: HintSide;
};

/** Icon-only button. Stops clicks from reaching a clickable card. */
export function IconButton({
  label,
  className,
  onClick,
  tooltip = true,
  tooltipSide,
  ...props
}: Props) {
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

  return (
    <Hint label={label} side={tooltipSide} disabled={!tooltip}>
      {button}
    </Hint>
  );
}
