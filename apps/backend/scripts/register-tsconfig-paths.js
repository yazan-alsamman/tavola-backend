/**
 * Resolves the @config/@common/@shared/@infrastructure/@modules path aliases
 * at runtime against the compiled dist/ output. TypeScript's "paths" option
 * is a compile-time-only construct - it does not rewrite emitted require()
 * calls - so this hook is required for both `start` and `start:dev`.
 */
const path = require('path');

process.env.TS_NODE_BASEURL = path.join(__dirname, '..', 'dist');

require('tsconfig-paths/register');
