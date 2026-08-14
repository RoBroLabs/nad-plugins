import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

const workspaceSource = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@nad/sdk': workspaceSource('./devkit/packages/sdk/src/index.ts'),
      '@nad/testkit': workspaceSource('./devkit/packages/testkit/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '.public-export/**', '.release-staging/**'],
    restoreMocks: true
  }
});
