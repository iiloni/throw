import type { ActivityChange, ActivityKind, CommentBody, McpInput, McpOutput } from '@throw/shared';
import { type SQL, sql } from 'drizzle-orm';
import { db, type Transaction } from '../db/client';
import type { HistoryField, structureActivity } from '../db/schema';
import type { McpActor } from '../lib/mcpTokens';
import { memberWorkspaces } from '../lib/workspaces';
import {
  type ChangeCursor,
  cursorFitsSnapshot,
  encodeChangeCursor,
  type FeedBoundary,
  type FeedSource,
  parseChangeCursor,
  snapshotBounds,
} from './changeCursor';
import { blocksToMarkdown } from './markdown';

type Output = McpOutput<'list_changes'>;
type Change = Output['changes'][number];

export class InvalidChangeCursor extends Error {
  constructor(readonly cursor: string) {
    super(
      'This change cursor is invalid for the current feed. Use the supplied cursor and read the board again, or start a time-based catch-up.',
    );
  }
}

type FeedRow = {
  id: string;
  source: FeedSource;
  txid: string;
  project_id: string | null;
  project_key: string | null;
  task_id: string | null;
  task_title: string | null;
  task_number: number | null;
  entity_id: string;
  user_id: string | null;
  via_token_name: string | null;
  created_at: string;
} & (
  | { source: 'task'; kind: ActivityKind; fields: ActivityChange[] }
  | {
      source: 'comment';
      kind: 'created' | 'updated' | 'deleted';
      fields: [CommentBody | null, CommentBody | null];
    }
  | {
      source: 'structure';
      kind: typeof structureActivity.$inferSelect.kind;
      entity_type: typeof structureActivity.$inferSelect.entityType;
      fields: HistoryField[];
    }
);

function taskChange(
  kind: ActivityKind,
  fields: ActivityChange[],
): Pick<Change, 'kind' | 'changes'> {
  const changed = fields.filter((field) => field.applied && field.previous !== field.requested);
  const trash = changed.find((field) => field.field === 'trashed');
  const moved = changed.some((field) => ['statusId', 'position', 'parentId'].includes(field.field));
  return {
    kind:
      kind === 'created'
        ? kind
        : trash
          ? trash.requested
            ? 'trashed'
            : 'restored'
          : moved
            ? 'moved'
            : 'updated',
    changes: fields.map(({ field, previous, requested, applied, tagId, reason }) => ({
      field,
      before: previous,
      after: applied ? requested : previous,
      applied,
      ...(applied ? {} : { requested }),
      tagId,
      reason,
    })),
  };
}

function formatChange(row: FeedRow): Change {
  const detail =
    row.source === 'task'
      ? taskChange(row.kind, row.fields)
      : row.source === 'comment'
        ? {
            kind: row.kind,
            changes: [
              {
                field: 'body',
                before: row.fields[0] === null ? null : blocksToMarkdown(row.fields[0]),
                after: row.fields[1] === null ? null : blocksToMarkdown(row.fields[1]),
              },
            ],
          }
        : { kind: row.kind, changes: row.fields };

  return {
    ...detail,
    id: row.id,
    type: row.source === 'structure' ? row.entity_type : row.source,
    entity: {
      id: row.entity_id,
      projectId: row.project_id,
      projectKey: row.project_key,
      taskId: row.task_id,
      taskKey:
        row.project_key && row.task_number !== null
          ? `${row.project_key}-${row.task_number}`
          : null,
      taskTitle: row.task_title,
    },
    actor: { userId: row.user_id, viaToken: row.via_token_name },
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function readBatch(
  tx: Transaction,
  actor: McpActor,
  excludeTokenId: string | null,
  base: FeedBoundary,
  through: string,
  last: Extract<ChangeCursor, { type: 'page' }>['last'] | undefined,
  limit: number,
) {
  const { xmax } = snapshotBounds(through);
  const lower =
    base.type === 'snapshot'
      ? sql`a.txid >= ${snapshotBounds(base.snapshot).xmin}::xid8
          AND NOT pg_visible_in_snapshot(a.txid, ${base.snapshot}::pg_snapshot)`
      : sql`a.created_at >= ${base.after}::timestamptz`;

  function page(
    source: FeedSource,
    table: SQL,
    projection: SQL,
    joins: SQL = sql``,
    extra = sql``,
  ) {
    // Index each source by workspace and transaction before merging the small pages.
    // Source breaks ties if two independently assigned IDs happen to coincide.
    const after = last
      ? sql`AND (a.txid, a.id) ${source > last.source ? sql`>=` : sql`>`}
               (${last.txid}::xid8, ${last.id}::uuid)`
      : sql``;
    return sql`(
      SELECT a.id, ${source}::text AS source, a.txid, a.project_id, a.user_id,
             a.via_token_name, a.created_at, a.kind, ${projection}
      FROM ${table} a ${joins}
      WHERE a.workspace_id = ${actor.workspaceId}::uuid
        AND a.workspace_id IN (${memberWorkspaces(tx, actor.userId, actor.workspaceId)})
        AND a.txid < ${xmax}::xid8
        AND pg_visible_in_snapshot(a.txid, ${through}::pg_snapshot)
        AND ${lower} ${after} ${extra}
        ${excludeTokenId ? sql`AND a.via_token_id IS DISTINCT FROM ${excludeTokenId}::uuid` : sql``}
      ORDER BY a.txid, a.id LIMIT ${limit}
    )`;
  }

  const taskJoins = sql`
    JOIN tasks t ON t.id = a.task_id AND t.workspace_id = a.workspace_id
    JOIN projects p ON p.id = a.project_id AND p.workspace_id = a.workspace_id
  `;
  const taskMetadata = sql`a.task_id, p.key AS project_key, t.title AS task_title, t.number AS task_number`;
  const task = page(
    'task',
    sql`task_activity`,
    sql`
    a.task_id AS entity_id, 'task'::text AS entity_type, a.changes AS fields, ${taskMetadata}
  `,
    taskJoins,
    sql`AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(a.changes) AS field
      WHERE field->>'applied' = 'false' OR field->'previous' IS DISTINCT FROM field->'requested'
    )`,
  );
  const comment = page(
    'comment',
    sql`comment_activity`,
    sql`
    a.comment_id AS entity_id, 'comment'::text AS entity_type,
    jsonb_build_array(a.before_body, a.after_body) AS fields, ${taskMetadata}
  `,
    taskJoins,
  );
  const structure = page(
    'structure',
    sql`structure_activity`,
    sql`
    a.entity_id, a.entity_type, a.changes AS fields,
    NULL::uuid AS task_id, a.project_key, NULL::text AS task_title, NULL::integer AS task_number
  `,
  );
  return tx.execute<FeedRow>(sql`
    SELECT * FROM (${task} UNION ALL ${comment} UNION ALL ${structure}) AS batch
    ORDER BY batch.txid, batch.id, batch.source COLLATE "C" LIMIT ${limit}
  `);
}

export function listChanges(actor: McpActor, input: McpInput<'list_changes'>): Promise<Output> {
  return db.transaction(
    async (tx) => {
      const [state] = await tx.execute<{ snapshot: string; generation: string }>(sql`
      SELECT pg_current_snapshot()::text AS snapshot, generation
      FROM change_feed_generation WHERE id
    `);
      if (!state) throw new Error('Change feed generation is missing');
      const scope = {
        generation: state.generation,
        workspaceId: actor.workspaceId,
      };
      const excludeTokenId = input.includeOwn ? null : actor.tokenId;
      const checkpoint = (snapshot: string) =>
        encodeChangeCursor({ ...scope, type: 'snapshot', snapshot });
      if (input.since === undefined)
        return { changes: [], cursor: checkpoint(state.snapshot), hasMore: false };

      let base: FeedBoundary;
      let paging: Extract<ChangeCursor, { type: 'page' }> | undefined;
      if (typeof input.since === 'string') {
        const cursor = parseChangeCursor(input.since);
        if (
          !cursor ||
          cursor.generation !== scope.generation ||
          cursor.workspaceId !== scope.workspaceId ||
          (cursor.type === 'page' && cursor.excludeTokenId !== excludeTokenId) ||
          !cursorFitsSnapshot(cursor, state.snapshot)
        ) {
          throw new InvalidChangeCursor(checkpoint(state.snapshot));
        }
        if (cursor.type === 'page') paging = cursor;
        base =
          cursor.type === 'page' ? cursor.base : { type: 'snapshot', snapshot: cursor.snapshot };
      } else {
        base = { type: 'time', after: input.since.after };
      }
      const through = paging?.through ?? state.snapshot;
      const rows = await readBatch(
        tx,
        actor,
        excludeTokenId,
        base,
        through,
        paging?.last,
        input.limit + 1,
      );
      const changes = rows.slice(0, input.limit).map(formatChange);
      if (rows.length <= input.limit)
        return { changes, cursor: checkpoint(through), hasMore: false };

      const { txid, id, source } = rows[input.limit - 1]!;
      return {
        changes,
        cursor: encodeChangeCursor({
          ...scope,
          type: 'page',
          excludeTokenId,
          base,
          through,
          last: { txid, id, source },
        }),
        hasMore: true,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
