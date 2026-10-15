import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { expect, it, vi } from 'vitest';
import type { Transaction } from '../db/client';
import { lockTagTree } from './tagTree';

it('uses one advisory lock for both spellings of a project UUID', async () => {
  const execute = vi.fn(async (_query: SQL) => []);
  const transaction = { execute } as unknown as Transaction;
  const projectId = '0199a0a0-abcd-7000-8000-abcdef123456';
  await lockTagTree(transaction, projectId);
  await lockTagTree(transaction, projectId.toUpperCase());
  const dialect = new PgDialect();
  const queries = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
  expect(queries[0]?.params).toEqual([`tags/${projectId}`]);
  expect(queries[1]).toEqual(queries[0]);
});
