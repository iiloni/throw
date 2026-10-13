import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'postgres://throw:throw@localhost:5432/throw_test',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
      ELECTRIC_URL: 'http://localhost:3001',
    },
  },
});
