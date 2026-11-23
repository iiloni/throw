import { describe, expect, it } from 'vitest';
import { createStatusSchema, statusSchema, updateStatusSchema } from './statuses';

const legacyStatus = {
  id: '01860d56-8495-7a31-b574-8ebc7470cda7',
  workspaceId: '01860d56-8495-7a31-b574-8ebc7470cda8',
  projectId: '01860d56-8495-7a31-b574-8ebc7470cda9',
  name: 'Review',
  category: 'active',
  position: 'a0',
  isDefault: false,
};

describe('status color', () => {
  it('accepts legacy shape rows and creates without a color', () => {
    expect(statusSchema.parse(legacyStatus)).toEqual(legacyStatus);
    const { workspaceId: _workspaceId, ...create } = legacyStatus;
    expect(createStatusSchema.parse(create)).toEqual(create);
    expect(updateStatusSchema.parse({ name: 'Verify' })).toEqual({ name: 'Verify' });
  });

  it('accepts named colors and explicit clears', () => {
    expect(createStatusSchema.parse({ ...legacyStatus, color: 'magenta' }).color).toBe('magenta');
    expect(updateStatusSchema.parse({ color: null })).toEqual({ color: null });
    expect(updateStatusSchema.safeParse({ color: '#ff0000' }).success).toBe(false);
  });
});
