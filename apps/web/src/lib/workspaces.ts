import { comparePositions, positionBetween, updateWorkspaceSchema } from '@throw/shared';
import { uuidv7 } from 'uuidv7';
import { workspacesCollection, write } from './collections';

export function createWorkspace(name: string) {
  const ordered = [...workspacesCollection.values()].sort((a, b) =>
    comparePositions(a.position, b.position),
  );
  const id = uuidv7();
  write(() =>
    workspacesCollection.insert({
      id,
      name: name.trim(),
      position: positionBetween(ordered.at(-1)?.position ?? null, null),
    }),
  );
  return id;
}

export function renameWorkspace(id: string, name: string) {
  const changes = updateWorkspaceSchema.parse({ name });
  write(() => workspacesCollection.update(id, (workspace) => Object.assign(workspace, changes)));
}
