import { useLayoutEffect, useRef, useState } from 'react';
import { useResolvedTheme } from '@/lib/theme';
import brand from '../../../../../throw-brand/shared/throw-brand-tokens.json';
import tokens from '../../../../../throw-brand/wordmarks/throw-wordmark-tokens.json';

type Props = {
  orientation: 'horizontal' | 'stacked';
  /** CSS pixels, also density-independent pixels in the Android WebView. */
  iconSize: number;
  channel?: 'stable' | 'preview' | 'dev';
  /** Use only when the surrounding surface differs from the application theme. */
  surface?: 'light' | 'dark';
};

export function BrandLockup({ orientation, iconSize, channel = 'stable', surface }: Props) {
  const theme = useResolvedTheme();
  const container = useRef<HTMLDivElement>(null);
  const canvas = tokens.layouts[orientation].canvas;
  const ratio = canvas[0]! / brand.canvas.width;
  const clearSpace = tokens.clearSpace / brand.canvas.width;
  const preferredWidth = iconSize * (ratio + 2 * clearSpace);
  const [width, setWidth] = useState(preferredWidth);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Browser layout rounds to fractional CSS pixels. Restore a threshold-sized icon
  // rather than accidentally choosing micro for a 48 px icon at high pixel density.
  const fitted = (span: number) =>
    Math.round(Math.min(iconSize, width / (span + 2 * clearSpace)) * 64) / 64;
  const minimum =
    orientation === 'horizontal'
      ? tokens.minimumDisplay.horizontalWidthCssPx
      : tokens.minimumDisplay.stackedWidthCssPx;
  const iconOnly = fitted(ratio) * ratio < minimum;
  const displayedIcon = fitted(iconOnly ? 1 : ratio);
  const tier =
    displayedIcon >= brand.variantRules.primary.minDisplayedPx
      ? ''
      : displayedIcon >= brand.variantRules.small.minDisplayedPx
        ? '-small'
        : '-micro';
  const ink = (surface ?? theme) === 'dark' ? 'light' : 'dark';
  const iconBase = channel === 'stable' ? '' : `/${channel}`;
  const source = iconOnly
    ? `${iconBase}/${tier === '' ? 'icon.svg' : tier === '-small' ? 'icon-small.svg' : 'favicon-mark.svg'}`
    : `/wordmarks/throw-lockup-${orientation}-${channel}-${ink}${tier}.svg`;

  return (
    <div
      ref={container}
      style={{
        width: preferredWidth,
        maxWidth: '100%',
        minWidth: brand.variantRules.micro.minDisplayedPx * (1 + 2 * clearSpace),
      }}
    >
      <div style={{ padding: displayedIcon * clearSpace }}>
        <img
          src={source}
          alt="Throw"
          width={iconOnly ? brand.canvas.width : canvas[0]}
          height={iconOnly ? brand.canvas.height : canvas[1]}
          style={{
            display: 'block',
            width: iconOnly ? displayedIcon : '100%',
            height: 'auto',
            marginInline: orientation === 'stacked' ? 'auto' : 0,
          }}
        />
      </div>
    </div>
  );
}
