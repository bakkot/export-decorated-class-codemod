# export-decorated-class codemod

A codemod to rewrite TS/TSX code from `@dec export class A {}` to `export @dec class A {}`.

Usage: `node transform.js path-to-project`.

If the argument is a directory, files recursively within that directory will be transformed (excluding `node_modules`).

Only `.ts` and `.tsx` files are touched.
