import Module from 'node:module';

// The mobile modules under test import React Native / Expo packages (directly,
// or through `./backend`) that cannot load under plain node. Rather than
// refactor source to suit the tests, or add Jest and its module-mock machinery
// (the repo's rule is node's built-in runner, see .claude/rules/testing.md),
// a test replaces exactly the modules it needs to before the module under test
// is required. Each stub is keyed by the specifier as WRITTEN in the source
// ('./backend', 'expo-file-system'), which is why it must be installed first:
// import this file (or a helper that does) above the import under test, and
// TypeScript's CommonJS output keeps that order.
//
// Node has an experimental `mock.module`, but it sits behind a flag and its
// behaviour differs between the node versions this repo runs on (>=20.9 locally,
// 22 in CI); patching the loader is the same on all of them. It leans on
// `Module._load`, which is undocumented, so it is confined to this one file.

type Loader = (this: unknown, request: string, parent: unknown, isMain: boolean) => unknown;
const internals = Module as unknown as { _load: Loader };
const original = internals._load;
const stubs = new Map<string, unknown>();

internals._load = function (request, parent, isMain) {
  return stubs.has(request) ? stubs.get(request) : original.call(this, request, parent, isMain);
};

/** Serve `exports` for `require(request)` from now on. Getters work, so a test can swap what a stub returns. */
export function stubModule(request: string, exports: object): void {
  stubs.set(request, exports);
}
