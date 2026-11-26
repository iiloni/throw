import { describe, expect, it } from 'vitest';
import {
  createGithubConnectionSchema,
  parseGithubRepository,
  sameGithubRepository,
  updateGithubConnectionSchema,
} from './github';

const token = 'github_pat_11AAAAAAA0123456789abcdef';

describe('parseGithubRepository', () => {
  it('reads a name or any address GitHub shows for it', () => {
    for (const input of [
      'iiloni/throw',
      ' iiloni/throw ',
      'https://github.com/iiloni/throw',
      'https://github.com/iiloni/throw.git',
      'https://github.com/iiloni/throw/',
      'git@github.com:iiloni/throw.git',
      'ssh://git@github.com/iiloni/throw',
    ])
      expect(parseGithubRepository(input), input).toBe('iiloni/throw');
    expect(parseGithubRepository('my-org/repo.name_2')).toBe('my-org/repo.name_2');
  });

  it('refuses what names no single repository', () => {
    for (const input of [
      '',
      'throw',
      'a/b/c',
      'https://github.com/iiloni',
      'https://github.com/iiloni/throw/pulls',
      '-owner/repo',
      'owner-/repo',
      'own_er/repo',
      'owner/..',
      'owner/.',
      'owner/re po',
      `${'a'.repeat(40)}/repo`,
      'http://[::1',
    ])
      expect(parseGithubRepository(input), input).toBeNull();
  });

  it('compares names without regard to case', () => {
    expect(sameGithubRepository('IiLoni/Throw', 'iiloni/throw')).toBe(true);
    expect(sameGithubRepository('iiloni/throw', 'iiloni/catch')).toBe(false);
  });
});

describe('connection bodies', () => {
  it('normalise the repository and default to webhook-only', () => {
    expect(
      createGithubConnectionSchema.parse({ repository: 'https://github.com/o/r.git' }),
    ).toEqual({ repository: 'o/r', authMode: 'webhook' });
  });

  it('pair a token with token mode only', () => {
    expect(createGithubConnectionSchema.safeParse({ repository: 'o/r', token }).success).toBe(
      false,
    );
    expect(
      createGithubConnectionSchema.safeParse({ repository: 'o/r', authMode: 'token' }).success,
    ).toBe(false);
    expect(
      createGithubConnectionSchema.safeParse({ repository: 'o/r', authMode: 'token', token })
        .success,
    ).toBe(true);
    expect(
      createGithubConnectionSchema.safeParse({
        repository: 'o/r',
        authMode: 'token',
        token: `${token} suffix`,
      }).success,
    ).toBe(false);
  });

  it('refuse empty, unknown or contradictory updates', () => {
    expect(updateGithubConnectionSchema.safeParse({}).success).toBe(false);
    expect(updateGithubConnectionSchema.safeParse({ secret: 'x' }).success).toBe(false);
    expect(updateGithubConnectionSchema.safeParse({ authMode: 'webhook', token }).success).toBe(
      false,
    );
    expect(updateGithubConnectionSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });
});
