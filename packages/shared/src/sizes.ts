import { z } from 'zod';

export const SIZES = [1, 2, 3, 4, 5] as const;
export const sizeSchema = z.union(SIZES.map((size) => z.literal(size)));
export type Size = z.infer<typeof sizeSchema>;

export const SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL'] as const;

export function sizeLabel(size: Size) {
  return SIZE_LABELS[size - 1]!;
}
