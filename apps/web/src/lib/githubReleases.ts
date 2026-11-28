import type { GithubRelease, TaskGithubLink, TaskGithubRelease } from '@throw/shared';

/**
 * The releases and tags that shipped a task (ADR 0017, THR-126), as the task pane and the
 * board's release filter read them from the synced, read-only collections.
 */

type ReleaseState = Pick<GithubRelease, 'isDraft' | 'publishedAt'>;

/**
 * Whether a release counts as shipped, as the server's `unreleased` reads it: published and
 * not a draft. Published prereleases count; a tag whose release was deleted does not.
 */
export const releaseShipped = (release: ReleaseState) =>
  !release.isDraft && release.publishedAt !== null;

/**
 * The server's release order: newest publication first, unpublished ones (drafts, tags whose
 * release went away) after them, then by id, newest first.
 */
export function compareReleases(
  a: Pick<GithubRelease, 'id' | 'publishedAt'>,
  b: Pick<GithubRelease, 'id' | 'publishedAt'>,
) {
  const at = (release: Pick<GithubRelease, 'publishedAt'>) =>
    release.publishedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(release.publishedAt);
  return at(b) - at(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/** A quiet word beside the tag for a release that is not an ordinary published one. */
export function releaseQualifier(
  release: Pick<GithubRelease, 'isDraft' | 'isPrerelease' | 'publishedAt' | 'source'>,
) {
  if (release.isDraft) return 'Draft';
  if (release.publishedAt === null) return 'Unpublished';
  if (release.isPrerelease) return 'Pre-release';
  if (release.source === 'tag') return 'Tag';
  return null;
}

/** Whether a task has a pull request that merged, which is what the next release ships. */
export const hasMergedPull = (links: readonly Pick<TaskGithubLink, 'kind' | 'state'>[]) =>
  links.some((link) => link.kind === 'pr' && link.state === 'merged');

/**
 * A task's releases, newest first, and whether its merged work still waits for one: a merged
 * pull request and no binding to a shipped release, as MCP's `list_tasks` `unreleased` asks.
 */
export function taskReleases(
  taskId: string,
  releases: readonly GithubRelease[],
  bindings: readonly Pick<TaskGithubRelease, 'taskId' | 'releaseId'>[],
  links: readonly Pick<TaskGithubLink, 'taskId' | 'kind' | 'state'>[],
) {
  const bound = new Set(
    bindings.filter((binding) => binding.taskId === taskId).map((binding) => binding.releaseId),
  );
  const own = releases.filter((release) => bound.has(release.id)).sort(compareReleases);
  const merged = hasMergedPull(links.filter((link) => link.taskId === taskId));
  return { releases: own, unreleased: merged && !own.some(releaseShipped) };
}

export type BoardRelease = Pick<
  GithubRelease,
  'id' | 'projectId' | 'tagName' | 'name' | 'isDraft' | 'isPrerelease' | 'publishedAt' | 'source'
>;

/**
 * Which of a board's tasks its release filter can choose: each task's releases, and the tasks
 * whose merged work no shipped release holds yet. The releases listed are the board projects'
 * that hold at least one of its tasks, newest first. Undefined when there is nothing to choose
 * (no such release and no merged pull request), so the board hides the filter.
 */
export type BoardReleases = {
  releases: readonly BoardRelease[];
  byTask: ReadonlyMap<string, ReadonlySet<string>>;
  unreleased: ReadonlySet<string>;
};

export function boardReleases(
  taskIds: Iterable<string>,
  releases: readonly GithubRelease[],
  bindings: readonly Pick<TaskGithubRelease, 'taskId' | 'releaseId'>[],
  links: readonly Pick<TaskGithubLink, 'taskId' | 'kind' | 'state'>[],
): BoardReleases | undefined {
  const tasks = new Set(taskIds);
  const byId = new Map(releases.map((release) => [release.id, release]));
  const byTask = new Map<string, Set<string>>();
  const shipped = new Set<string>();
  for (const binding of bindings) {
    const release = byId.get(binding.releaseId);
    if (!release || !tasks.has(binding.taskId)) continue;
    const own = byTask.get(binding.taskId);
    if (own) own.add(release.id);
    else byTask.set(binding.taskId, new Set([release.id]));
    if (releaseShipped(release)) shipped.add(binding.taskId);
  }
  const unreleased = new Set<string>();
  for (const link of links)
    if (link.kind === 'pr' && link.state === 'merged' && tasks.has(link.taskId))
      if (!shipped.has(link.taskId)) unreleased.add(link.taskId);
  const used = new Set([...byTask.values()].flatMap((ids) => [...ids]));
  const listed = releases.filter((release) => used.has(release.id)).sort(compareReleases);
  if (listed.length === 0 && unreleased.size === 0) return undefined;
  return { releases: listed, byTask, unreleased };
}
