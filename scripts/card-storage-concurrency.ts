/** Runs only against verify-migrations.sh's disposable database. Two real
 * sessions prove both writer orders preserve the last printing snapshot. */
import assert from "node:assert/strict";
import postgres from "postgres";

const options = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? "55432"),
  username: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.DBNAME ?? "mtg_verify",
  max: 1,
};
const connect = () => process.env.PGURL
  ? postgres(process.env.PGURL, { database: options.database, max: 1 })
  : postgres(options);
const admin = connect(), first = connect(), second = connect();
const id = "cafe0000-0000-0000-0000-000000000091";
const oracle = "cafe0000-0000-0000-0000-000000000092";
const source = {
  scryfall_id: id, oracle_id: oracle, name: "Concurrency fixture",
  set_code: "tst", collector_number: "91", mana_cost: null, cmc: 1,
  type_line: "Creature", oracle_text: "Original", colors: [],
  color_identity: [], keywords: [], power: null, toughness: null,
  loyalty: null, produced_mana: null, game_changer: false, layout: "normal",
};
const ingest = (db: typeof admin) => db`select public.ingest_card_printings(${db.json([source])}::jsonb)`;
async function waitForLock(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await admin`select wait_event from pg_stat_activity where pid=${pid}`;
    if (row?.wait_event === "advisory") return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("Second writer did not wait on the catalog transaction lock");
}
async function main() {
  let inTransaction = false;
  try {
    for (const oracleFirst of [true, false]) {
      await admin`delete from public.card_printings where scryfall_id=${id}`;
      await admin`delete from public.oracle_cards where oracle_id=${oracle}`;
      await admin`insert into public.oracle_cards(oracle_id,name,oracle_text,cmc,type_line,colors,color_identity,keywords,game_changer,layout,content_hash)
        values(${oracle},'Concurrency fixture','Original',1,'Creature','{}','{}','{}',false,'normal','fixture')`;
      await ingest(admin);
      await first`begin`;
      inTransaction = true;
      if (oracleFirst) await first`update public.oracle_cards set oracle_text='New' where oracle_id=${oracle}`;
      else await ingest(first);
      const [{ pid }] = await second`select pg_backend_pid() as pid`;
      const waiting = oracleFirst
        ? ingest(second)
        : second`update public.oracle_cards set oracle_text='New' where oracle_id=${oracle}`;
      // Start the lazy query before observing its blocked backend.
      const completed = waiting.then(() => undefined);
      try {
        await waitForLock(pid);
      } finally {
        await first`commit`;
        inTransaction = false;
      }
      await completed;
      const [effective] = await admin`select oracle_text from public.cards where scryfall_id=${id}`;
      assert.equal(effective.oracle_text, "Original", "Concurrent Oracle update changed the printing snapshot");
      console.log(`PASS concurrent ${oracleFirst ? "Oracle → printing" : "printing → Oracle"} writer lock and snapshot`);
    }
  } finally {
    if (inTransaction) await first`rollback`;
    await admin`delete from public.card_printings where scryfall_id=${id}`;
    await admin`delete from public.oracle_cards where oracle_id=${oracle}`;
    await Promise.all([admin.end(), first.end(), second.end()]);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
