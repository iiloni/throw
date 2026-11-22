import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { usePersistentState } from './storage';
import { useUpdates } from './updates';

export const APP_ICON_KEY = 'throw-app-icon';
const iconSchema = z.enum(['stable', 'preview', 'dev']);
export type AppIcon = z.infer<typeof iconSchema>;
const ICONS = iconSchema.options;

// A local plugin in the Android project (AppIconsPlugin.java), ported from Catch.
const AppIcons = registerPlugin<{
  setIcon(options: { icon: AppIcon }): Promise<void>;
  getPreview(options: { icon: AppIcon }): Promise<unknown>;
}>('AppIcons');
const previewSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
});

export function appIconLabel(icon: AppIcon) {
  return icon === 'dev' ? 'Dev' : icon === 'preview' ? 'Preview' : 'Stable';
}

/** Where a build's own artwork lives: stable at the root, other channels in their folder. */
export function appIconBase(icon: AppIcon) {
  return icon === 'stable' ? '' : `/${icon}`;
}

/**
 * The icons a build can wear: its own channel's and those of the channels it comes before.
 * Stable has only its own, preview adds Stable, and dev can show any of the three. The
 * Android app refuses the same choices (AppIcons.java), and index.html restores them.
 */
export function appIconChoices(channel: AppIcon): AppIcon[] {
  return ICONS.slice(0, ICONS.indexOf(channel) + 1);
}

/** The installed build's channel: the Android app's own once known, else the web build's. */
function useBuildChannel(): AppIcon {
  const { android, app } = useUpdates();
  return (android && app?.channel) || import.meta.env.THROW_CHANNEL;
}

/** The icon this device shows, the choices it has and a setter that saves a new one. */
export function useAppIconPreference() {
  const channel = useBuildChannel();
  const choices = appIconChoices(channel);
  const [saved, setSaved] = usePersistentState(APP_ICON_KEY, iconSchema.nullable(), null);
  const icon = saved && choices.includes(saved) ? saved : channel;
  return { icon, choices, setIcon: setSaved };
}

export async function getNativeAppIconPreview(icon: AppIcon): Promise<string> {
  return previewSchema.parse(await AppIcons.getPreview({ icon })).dataUrl;
}

// Component settings belong to the whole APK; keep changes ordered across startup and taps.
let nativeChange = Promise.resolve();
export function setNativeAppIcon(icon: AppIcon): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return Promise.resolve();
  nativeChange = nativeChange.catch(() => {}).then(() => AppIcons.setIcon({ icon }));
  return nativeChange;
}

/** Points the favicons, Apple touch icon and install manifest at one icon's artwork. */
export function applyBrowserIcon(icon: AppIcon) {
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="apple-touch-icon"]',
  )) {
    const filename = new URL(link.href).pathname.split('/').pop();
    if (filename) link.setAttribute('href', `${appIconBase(icon)}/${filename}`);
  }
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute('href', `/manifest-${icon}.webmanifest`);
}

/** Keeps the browser and launcher icons on the device's choice, restoring it at launch. */
export function useApplyAppIcon() {
  const { icon } = useAppIconPreference();
  useEffect(() => {
    applyBrowserIcon(icon);
    let stopped = false;
    void setNativeAppIcon(icon).catch(() => {
      if (!stopped) toast.error('Could not change the app icon. Try again.');
    });
    return () => {
      stopped = true;
    };
  }, [icon]);
}
