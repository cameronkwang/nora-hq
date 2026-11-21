/**
 * Lets a tsx test script import the server-only modules (lib/ops-*, lib/db) outside Next.js: "server-only" resolves
 * to this file, which exports nothing. Use it with a throwaway PGlite database, never with DATABASE_URL:
 *   PGLITE_DIR=$(mktemp -d) npx tsx --require ./scripts/server-only-shim.cjs scripts/test-invoices-ops.ts
 * (Node's "react-server" condition is not an option: it swaps React for its server build and next/navigation breaks.)
 */
const Module = require("node:module");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return __filename;
  return resolve.call(this, request, ...rest);
};
