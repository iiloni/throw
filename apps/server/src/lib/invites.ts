import { createHash, randomBytes } from 'node:crypto';
import { INVITE_DAYS, inviteTokenSchema } from '@throw/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { invites } from '../db/schema';

export const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new invite's token, which goes in its link and nowhere else, with what the table keeps. */
export function newInvite(now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000),
  };
}

/**
 * Uses up an invite, if the token is one that is still good. One statement, so two
 * sign-ups racing on the same link cannot both win.
 */
export async function claimInvite(tx: Transaction, token: string): Promise<boolean> {
  if (!inviteTokenSchema.safeParse(token).success) return false;
  const claimed = await tx
    .update(invites)
    .set({ usedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(invites.tokenHash, hashInviteToken(token)),
        isNull(invites.usedAt),
        gt(invites.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .returning({ id: invites.id });
  return claimed.length > 0;
}

/** Records the account a claimed invite made, for the admin's list. */
export async function recordInvitedUser(tx: Transaction, token: string, userId: string) {
  await tx
    .update(invites)
    .set({ usedBy: userId })
    .where(eq(invites.tokenHash, hashInviteToken(token)));
}
