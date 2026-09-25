/**
 * Contract check between what the app WRITES and what the database ACCEPTS.
 *
 * The schema tests (supabase/tests/schema_test.sql, sections 27 and 28) prove
 * the constraints and the row security with hand-written stand-in snapshots.
 * This prints SQL that runs the app's REAL output through the same tables: a
 * real save from `prepareSave`, and a real projection from `projectPublic`
 * through `get_playtest_share` as a signed-in reader. The SQL asserts inside a
 * transaction that is rolled back, and this script asserts, on the TypeScript
 * side, that what the function hands back still passes the app's own
 * validators. It never connects to anything itself: pipe it to psql, on a
 * THROWAWAY database only.
 *
 *   npx tsx scripts/playtest-db-contract.ts | psql -v ON_ERROR_STOP=1 -h localhost -p <port> -U postgres <scratch db>
 *
 * Not part of `npm test` (it needs a migrated Postgres, like `test:db`).
 */

import assert from "node:assert/strict";

import { applyCommand } from "../src/lib/playtest/board/reduce";
import { fixtureCommanderStart } from "../src/lib/playtest/board/fixtures";
import { projectPublic, readProjection, PROJECTION_VERSION } from "../src/lib/playtest/board/share";
import { validateSnapshot } from "../src/lib/playtest/board/serialize";
import { prepareSave } from "../src/lib/playtest/session";
import type { GameCommand } from "../src/lib/playtest/board/commands";
import type { GameState } from "../src/lib/playtest/board/types";

const SECRET_NOTE = "SECRET-NOTE-do-not-share";

function played(): GameState {
  let state = fixtureCommanderStart();
  const run = (command: GameCommand) => {
    state = applyCommand(state, command, { ts: 1_000 });
  };
  run({ type: "DRAW", count: 7 });
  const [a, b, c] = state.zones.hand;
  run({ type: "MOVE_MANY", ids: [a], to: "battlefield", at: "top", pos: { x: 0.3, y: 0.3 } });
  run({ type: "MOVE_MANY", ids: [b], to: "battlefield", at: "top", pos: { x: 0.5, y: 0.3 }, faceDown: true });
  run({ type: "SET_NOTE", cardId: c, note: SECRET_NOTE });
  run({
    type: "CREATE_EXTRA",
    ids: ["extra-1"],
    spec: { name: "Soldier", typeLine: "Token Creature — Soldier", power: "1", toughness: "1", imageSmall: "https://evil.example/tracker.png", imageNormal: "https://evil.example/tracker-large.png" },
    kind: "token",
    zone: "battlefield",
  });
  run({ type: "NEXT_TURN" });
  return state;
}

const lit = (text: string) => `$json$${text}$json$`;
const ALICE = "c4700000-0000-0000-0000-000000000001";
const BOB = "c4700000-0000-0000-0000-000000000002";
const DECK = "c4710000-0000-0000-0000-000000000001";

const state = played();
const prepared = prepareSave(state);
assert.ok(!("error" in prepared), "a real played game fits in a save");
const { canonical, preview } = prepared;
const projectionHidden = projectPublic(state, { showHand: false });
const projectionShown = projectPublic(state, { showHand: true });

// What the app validates on the way IN must accept its own canonical output.
validateSnapshot(JSON.parse(canonical));
assert.ok(readProjection(JSON.parse(JSON.stringify(projectionHidden))), "projection (hand hidden) passes its own reader");
assert.ok(readProjection(JSON.parse(JSON.stringify(projectionShown))), "projection (hand shown) passes its own reader");

const out: string[] = [];
const sql = (text: string) => out.push(text);

sql("begin;");
sql(`insert into auth.users (id, email, raw_user_meta_data) values ('${ALICE}', 'alice-contract@example.com', '{"username":"alicecontract"}'), ('${BOB}', 'bob-contract@example.com', '{"username":"bobcontract"}');`);
sql(`insert into public.locations (id, user_id, name, type, is_public) values ('${DECK}', '${ALICE}', 'Contract deck', 'deck', true);`);

// Alice saves the real snapshot and reads it back unchanged.
sql(`select set_config('request.jwt.claim.sub', '${ALICE}', true);`);
sql("set local role authenticated;");
sql(`insert into public.playtest_sessions (owner_user_id, deck_id, title, schema_version, source_fingerprint, snapshot, preview)
values ('${ALICE}', '${DECK}', 'Contract save', ${state.schemaVersion}, '${state.source.fingerprint}', ${lit(canonical)}::jsonb, ${lit(JSON.stringify(preview))}::jsonb);`);
sql(`do $$ begin
  assert (select count(*) from public.playtest_sessions) = 1, 'alice reads her save';
  assert (select snapshot from public.playtest_sessions) = ${lit(canonical)}::jsonb, 'the snapshot reads back unchanged';
  assert (select length(snapshot::text) from public.playtest_sessions) < 262144, 'inside the size cap';
end $$;`);

// Alice shares (token comes from the default, never from the client), twice: hand hidden and shown.
for (const [name, projection, showHand] of [
  ["hidden", projectionHidden, false],
  ["shown", projectionShown, true],
] as const) {
  sql(`insert into public.playtest_shares (owner_user_id, deck_id, title, projection, projection_version, show_hand)
values ('${ALICE}', '${DECK}', 'Contract share ${name}', ${lit(JSON.stringify(projection))}::jsonb, ${PROJECTION_VERSION}, ${showHand});`);
}
sql("reset role;");

// Bob, a signed-in link holder, reads through the function and sees no owner or deck identifiers.
sql(`select set_config('request.jwt.claim.sub', '${BOB}', true);`);
sql("set local role authenticated;");
sql(`do $$
declare tok text; got jsonb; k text;
begin
  reset role;
  for tok in select token from public.playtest_shares order by created_at loop
    set local role authenticated;
    got := public.get_playtest_share(tok);
    reset role;
    assert got is not null, 'a signed-in holder of the link reads the share';
    for k in select jsonb_object_keys(got) loop
      assert k in ('title','projection','updatedAt','expiresAt'), 'unexpected key from get_playtest_share: ' || k;
    end loop;
    assert not (got::text ~* '(owner_user_id|deck_id|c4700000|c4710000)'), 'no owner or deck identifier in the payload';
    assert not (got::text like '%${SECRET_NOTE}%'), 'the private note is not in the payload';
    assert not (got::text like '%evil.example%'), 'the arbitrary image host is not in the payload';
  end loop;
end $$;`);
sql("reset role;");

// Bob cannot read Alice's saves or her share rows directly.
sql("set local role authenticated;");
sql(`do $$ begin
  assert (select count(*) from public.playtest_sessions) = 0, 'bob sees none of alice''s saves';
  assert (select count(*) from public.playtest_shares) = 0, 'bob sees none of alice''s share rows';
end $$;`);
sql("reset role;");
sql("rollback;");
sql("\\echo playtest-db-contract: all assertions passed");

process.stdout.write(out.join("\n") + "\n");
