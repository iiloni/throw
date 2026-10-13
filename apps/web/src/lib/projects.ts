import {
  COLORS,
  comparePositions,
  type Project,
  positionBetween,
  type UpdateProject,
  updateProjectSchema,
} from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { projectsCollection, write } from './collections';

/** A workspace's projects in their arranged order. */
export function projectsIn(projects: readonly Project[], workspaceId: string) {
  return projects
    .filter((project) => project.workspaceId === workspaceId)
    .sort((a, b) => comparePositions(a.position, b.position));
}

/** Adds a project at the end of its workspace, in the next color nobody there has taken. */
export function createProject(
  workspaceId: string,
  name: string,
  appearance?: Pick<Project, 'color' | 'icon'>,
) {
  const siblings = projectsIn([...projectsCollection.values()], workspaceId);
  const used = new Set(siblings.map((project) => project.color));
  const id = uuidv7();
  write(() => {
    projectsCollection.insert({
      id,
      workspaceId,
      name: name.trim(),
      color: COLORS.find((color) => !used.has(color)) ?? COLORS[siblings.length % COLORS.length]!,
      icon: null,
      position: positionBetween(siblings.at(-1)?.position ?? null, null),
      ...appearance,
    });
  });
  return id;
}

export function updateProject(id: string, changes: UpdateProject) {
  const valid = updateProjectSchema.parse(changes);
  write(() => projectsCollection.update(id, (project) => Object.assign(project, valid)));
}

export function deleteProject(id: string) {
  write(() => {
    projectsCollection.delete(id);
  });
}
