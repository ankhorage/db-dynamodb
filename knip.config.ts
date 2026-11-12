import { createKnipConfig } from '@ankhorage/devtools/knip';

export default createKnipConfig({
  entry: [
    'src/index.ts',
    'test/**/*.ts',
    'eslint.config.mjs',
    'prettier.config.cjs',
    'paradox.config.ts',
  ],
});
