import { z } from 'zod';

const comparison = z.object({ status: z.enum(['ahead', 'identical', 'behind', 'diverged']) });

/** Compare merge commit (base) to release tag (head). Null leaves the time window authoritative. */
export async function containsMerge(
  repo: string,
  tag: string,
  sha: string,
  token: string,
  signal: AbortSignal,
) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/compare/${sha}...${encodeURIComponent(tag)}?per_page=1`,
      { headers: { Authorization: `Bearer ${token}` }, signal, redirect: 'error' },
    );
    if (!response.ok) return null;
    const data = comparison.safeParse(await response.json());
    return data.success ? ['ahead', 'identical'].includes(data.data.status) : null;
  } catch {
    return null;
  }
}
