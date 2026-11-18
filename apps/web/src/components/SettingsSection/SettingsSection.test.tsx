import { render, screen } from '@testing-library/react';
import { Bell } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { SettingsRow, SettingsSection } from './SettingsSection';

describe('settings sections', () => {
  it('names its group by its title and keeps each row with its control', () => {
    render(
      <SettingsSection title="Notifications" description="Only on this device.">
        <SettingsRow icon={Bell} label="Reminders" description="Before a task is due.">
          <button type="button">Off</button>
        </SettingsRow>
      </SettingsSection>,
    );
    const section = screen.getByRole('region', { name: 'Notifications' });
    expect(section).toHaveTextContent('Only on this device.');
    expect(section).toHaveTextContent('Reminders');
    expect(section).toHaveTextContent('Before a task is due.');
    expect(screen.getByRole('button', { name: 'Off' })).toBeInTheDocument();
  });
});
