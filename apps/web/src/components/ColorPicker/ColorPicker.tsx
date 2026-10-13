import { COLORS, type Color } from '@throw/shared';
import { Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export function ColorPicker({
  value,
  onChange,
}: {
  value: Color;
  onChange: (color: Color) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <fieldset className="grid grid-cols-6 justify-items-center gap-2">
      <legend className="mb-2 text-sm font-medium">Project colour</legend>
      {COLORS.map((color) => (
        <motion.button
          key={color}
          type="button"
          data-color={color}
          aria-label={
            color === 'dark-blue' ? 'Indigo' : color.charAt(0).toUpperCase() + color.slice(1)
          }
          aria-pressed={value === color}
          whileTap={reduced ? undefined : { scale: 0.85 }}
          transition={springs.snappy}
          onClick={() => onChange(color)}
          className={cn(
            'flex size-10 items-center justify-center rounded-full border bg-tint text-tint-accent outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            value === color
              ? 'border-foreground/70 ring-2 ring-foreground/15'
              : 'border-foreground/10',
          )}
        >
          {value === color && <Check className="size-4" aria-hidden />}
        </motion.button>
      ))}
    </fieldset>
  );
}
