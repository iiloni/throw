import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hasPriorityIcon, PriorityGlyph, PriorityIcon } from './glyphs';
import type { Priority } from './model';

const TONES: [Priority, string][] = [
  [1, 'text-priority-critical'],
  [2, 'text-priority-high'],
  [4, 'text-priority-low'],
  [5, 'text-priority-lowest'],
];
const ALL_TONES = TONES.map(([, tone]) => tone);

describe('PriorityIcon', () => {
  it.each(TONES)('colors rank %i with %s', (priority, tone) => {
    const { container } = render(<PriorityIcon priority={priority} />);
    const icon = container.querySelector('svg');
    expect(icon).toHaveClass(tone);
    for (const other of ALL_TONES.filter((t) => t !== tone)) expect(icon).not.toHaveClass(other);
  });

  it('keeps its color beside a caller’s layout class', () => {
    const { container } = render(<PriorityIcon priority={2} className="zone-chevron" />);
    expect(container.querySelector('svg')).toHaveClass('zone-chevron', 'text-priority-high');
  });

  it('draws nothing for the default rank', () => {
    const { container } = render(<PriorityIcon priority={3} />);
    expect(hasPriorityIcon(3)).toBe(false);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PriorityGlyph', () => {
  it.each(TONES)('names rank %i and draws its colored chevron', (priority, tone) => {
    render(<PriorityGlyph priority={priority} name="Rank" />);
    const glyph = screen.getByRole('img', { name: 'Priority: Rank' });
    expect(glyph.querySelector('svg')).toHaveClass(tone);
  });

  it('stays quiet for the default rank, as most cards have it', () => {
    const { container } = render(<PriorityGlyph priority={3} name="Normal" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('priority tokens', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

  it.each(['critical', 'high', 'low', 'lowest'])(
    'defines --priority-%s for both themes and as a Tailwind color',
    (name) => {
      expect(css).toMatch(new RegExp(`--priority-${name}: (light-dark\\(|var\\(--destructive\\))`));
      expect(css).toContain(`--color-priority-${name}: var(--priority-${name});`);
    },
  );
});
