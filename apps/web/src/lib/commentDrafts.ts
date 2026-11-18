import { type Description, descriptionSchema } from '@throw/shared';
import { getServerUrl } from './serverUrl';

const prefix = (userId: string) => `throw-comment:${getServerUrl()}:${userId}:`;

export function commentDraftKey(userId: string | null, draftId: string) {
  return userId ? `${prefix(userId)}${draftId}` : null;
}

export function readCommentDraft(key: string | null): Description {
  if (!key) return null;
  try {
    const parsed = descriptionSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storeCommentDraft(key: string | null, document: Description) {
  if (!key) return;
  try {
    if (document) localStorage.setItem(key, JSON.stringify(document));
    else localStorage.removeItem(key);
  } catch {
    // Storage can be full or blocked; the editor still holds the text while it is open.
  }
}

export function clearCommentDrafts(userId: string) {
  const owned = prefix(userId);
  for (const name of Object.keys(localStorage))
    if (name.startsWith(owned)) localStorage.removeItem(name);
}
