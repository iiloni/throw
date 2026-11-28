import { createFileRoute } from '@tanstack/react-router';
import { ShortcutSettings } from '@/components/KeyboardShortcuts/ShortcutSettings';

export const Route = createFileRoute('/_app/settings/shortcuts')({ component: ShortcutSettings });
