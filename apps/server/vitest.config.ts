import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      OPENDOTS_DATA_DIR: join(tmpdir(), `opendots-test-${process.pid}`),
      OPENDOTS_ALLOW_PRIVATE_FETCH: '1',
      OPENROUTER_API_KEY: '',
      OPENDOTS_CONTAINER: 'opendots-computer-test',
    },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
