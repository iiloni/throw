import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      THROW_TEST_POSTGRES:
        process.env.THROW_DB_TESTS === '1' ? (process.env.DATABASE_URL ?? '') : '',
      DATABASE_URL: 'postgres://throw:throw@localhost:5432/throw_test',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
      ELECTRIC_URL: 'http://localhost:3001',
    },
  },
});
