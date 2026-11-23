import { COLORS, type Color } from '@throw/shared';
import { Ban, Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Hint } from '@/components/Hint/Hint';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export function colorName(color: Color) {
  return color === 'dark-blue' ? 'Indigo' : color.charAt(0).toUpperCase() + color.slice(1);
}

type Props =
  | { allowNone?: false; value: Color; onChange: (color: Color) => void }
  | { allowNone: true; value: Color | null; onChange: (color: Color | null) => void };

export function ColorPicker(props: Props) {
  const { value, onChange, allowNone } = props;
  const reduced = useReducedMotion();
  return (
    <fieldset className="grid grid-cols-6 justify-items-center gap-2">
      <legend className="mb-2 text-sm font-medium">
        {allowNone ? 'Status color' : 'Project color'}
      </legend>
      {(allowNone ? [null, ...COLORS] : COLORS).map((color) => {
        const label = color === null ? 'No color' : colorName(color);
        return (
          <Hint key={label} label={label} disabled={!allowNone}>
            <motion.button
              type="button"
              data-color={color ?? undefined}
              aria-label={label}
              aria-pressed={value === color}
              whileTap={reduced ? undefined : { scale: 0.85 }}
              transition={springs.snappy}
              onClick={() => {
                if (color !== value) haptics.selection();
                if (color !== null) onChange(color);
                else if (allowNone) onChange(null);
              }}
              className={cn(
                'flex size-10 items-center justify-center rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                color === null ? 'bg-muted text-muted-foreground' : 'bg-tint text-tint-accent',
                value === color
                  ? 'border-foreground/70 ring-2 ring-foreground/15'
                  : 'border-foreground/10',
              )}
            >
              {color === null ? (
                <Ban className="size-4" aria-hidden />
              ) : (
                value === color && <Check className="size-4" aria-hidden />
              )}
            </motion.button>
          </Hint>
        );
      })}
    </fieldset>
  );
}
