import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: { TZ: 'Europe/London', FROSTLINE_DB: ':memory:', ANTHROPIC_API_KEY: '' },
    pool: 'forks',
  },
});
