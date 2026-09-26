import { stubModule } from './stubs';

// A stand-in for the Supabase client that records what was asked and answers
// from a function the test supplies. It is deliberately dumb: every query
// method (`select`, `eq`, `in`, `range`, `maybeSingle` ...) returns the same
// builder and is remembered as an `{ method, args }` op, and awaiting the
// builder calls the responder. That is enough to assert the two things these
// modules are responsible for -- which rows a query ASKED for (owner scoping,
// paging, the digital filter) and what the code does with each kind of answer
// (rows, an error, a throw, a hang).

export type Call = { table: string; ops: { method: string; args: unknown[] }[] };
export type Reply = { data: unknown; error: { message: string; code?: string } | null };
export type Responder = (call: Call) => Reply | Promise<Reply>;

export class FakeBackend {
  readonly calls: Call[] = [];
  constructor(private readonly respond: Responder) {}

  from(table: string): unknown {
    const call: Call = { table, ops: [] };
    this.calls.push(call);
    const respond = this.respond;
    const builder: object = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(() => respond(call)).then(resolve, reject);
        }
        return (...args: unknown[]) => { call.ops.push({ method: String(prop), args }); return builder; };
      },
    });
    return builder;
  }

  callsTo(table: string): Call[] { return this.calls.filter(c => c.table === table); }
}

/** The value a query passed to `.eq(column, value)`, or undefined if it never filtered on that column. */
export function eqValue(call: Call, column: string): unknown {
  return call.ops.find(o => o.method === 'eq' && o.args[0] === column)?.args[1];
}

export const ok = (data: unknown): Reply => ({ data, error: null });
export const fail = (message: string, code?: string): Reply => ({ data: null, error: { message, code } });
/** A reply that never arrives, for the timeout paths. */
export const never = (): Promise<Reply> => new Promise<Reply>(() => {});

let current: FakeBackend | null = null;
stubModule('./backend', { get backend() { return current; } });

/** Installs the fake as `backend` (null = signed out / not configured). */
export function setBackend(fake: FakeBackend | null): void { current = fake; }

// crashReporting pulls in @sentry/react-native; errors.ts is the only door to it.
export const reported: { error: unknown; context: string }[] = [];
stubModule('./crashReporting', { captureError: (error: unknown, context: string) => { reported.push({ error, context }); } });
