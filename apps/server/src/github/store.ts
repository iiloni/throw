import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { githubConnections, githubDeliveries, projects } from '../db/schema';
import type { GithubReceiverStore, LastDelivery } from './receive';

/** GitHub redelivers on request for three days; a week of IDs covers that with room. */
const KEEP_DELIVERIES = sql`interval '7 days'`;

const lastDelivery = (delivery: LastDelivery) => ({
  lastDeliveryAt: delivery.at,
  lastDeliveryId: delivery.id,
  lastDeliveryEvent: delivery.event,
  lastDeliveryStatus: delivery.status,
  lastDeliveryDetail: delivery.detail,
});

export const githubReceiverStore: GithubReceiverStore = {
  async connection(token) {
    const [row] = await db
      .select({
        id: githubConnections.id,
        workspaceId: githubConnections.workspaceId,
        projectId: githubConnections.projectId,
        repository: githubConnections.repository,
        enabled: githubConnections.enabled,
        encryptedWebhookSecret: githubConnections.encryptedWebhookSecret,
        projectTrashed: sql<boolean>`${projects.deletedAt} IS NOT NULL`,
      })
      .from(githubConnections)
      .innerJoin(projects, eq(projects.id, githubConnections.projectId))
      .where(eq(githubConnections.webhookToken, token));
    return row;
  },

  accept(connection, delivery, handle) {
    return db.transaction(async (tx) => {
      // Lock before claiming: a delivery racing a disable remains eligible for redelivery.
      // Project purging locks the project before cascading to its connection.
      const [project] = await tx
        .select({ trashed: projects.deletedAt })
        .from(projects)
        .where(eq(projects.id, connection.projectId))
        .for('share');
      if (!project) return { status: 'ignored' as const, reason: 'Project removed.' };
      const [current] = await tx
        .select({
          enabled: githubConnections.enabled,
          repo: githubConnections.repository,
          secret: githubConnections.encryptedWebhookSecret,
        })
        .from(githubConnections)
        .where(eq(githubConnections.id, connection.id))
        .for('no key update');
      if (
        !current?.enabled ||
        project.trashed ||
        current.repo.toLowerCase() !== connection.repository.toLowerCase() ||
        current.secret !== connection.encryptedWebhookSecret
      ) {
        const reason = 'Connection changed before the delivery was claimed.';
        await tx
          .update(githubConnections)
          .set(
            lastDelivery({
              at: new Date(),
              id: delivery.id,
              event: delivery.event,
              status: 'ignored',
              detail: reason,
            }),
          )
          .where(eq(githubConnections.id, connection.id));
        return { status: 'ignored' as const, reason };
      }
      await tx
        .delete(githubDeliveries)
        .where(
          and(
            eq(githubDeliveries.connectionId, connection.id),
            lt(githubDeliveries.receivedAt, sql`now() - ${KEEP_DELIVERIES}`),
          ),
        );
      // A concurrent delivery of the same ID waits here for the first to commit or roll back.
      const [claimed] = await tx
        .insert(githubDeliveries)
        .values({ connectionId: connection.id, deliveryId: delivery.id, event: delivery.event })
        .onConflictDoNothing()
        .returning({ id: githubDeliveries.deliveryId });
      if (!claimed) return 'duplicate';
      const handled = await handle(tx);
      await tx
        .update(githubConnections)
        .set(
          lastDelivery({
            at: new Date(),
            id: delivery.id,
            event: delivery.event,
            status: handled.status,
            detail: handled.status === 'ignored' ? handled.reason : null,
          }),
        )
        .where(eq(githubConnections.id, connection.id));
      return handled;
    });
  },

  async record(connectionId, delivery) {
    await db
      .update(githubConnections)
      .set(lastDelivery(delivery))
      .where(eq(githubConnections.id, connectionId));
  },
};
