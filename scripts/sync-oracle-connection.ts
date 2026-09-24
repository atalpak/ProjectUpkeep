/**
 * How the Scryfall loader connects to Postgres, and what it refuses to.
 *
 * Split from scripts/sync-oracle-direct.ts so the decisions can be tested
 * without opening a connection (scripts/sync-oracle-connection.test.ts). It
 * lives under scripts/ for the same reason the loader does: the connection
 * string is as powerful as the role it names (hard constraint 4 in CLAUDE.md),
 * so the driver and the variable are confined to the repo-root scripts/, and
 * ESLint bans both everywhere else.
 *
 * Three things here are easy to get wrong and quiet when they are:
 *
 *   TLS is VERIFIED. postgres.js treats `ssl: 'require'` (and a `?sslmode=`
 *   in the URL) as "encrypt but accept any certificate", which stops a passive
 *   listener and nobody else. The options below always pass an object, whose
 *   default is to verify the certificate and hostname, and any sslmode the
 *   URL carries is discarded so it cannot downgrade that. Supabase's pooler
 *   certificate chains to Supabase's own CA rather than a public one, so the
 *   CA can be supplied as PEM (SCRYFALL_SYNC_DATABASE_CA); without it Node's
 *   default trust store is used and a failure says so.
 *
 *   Session mode, not transaction mode. The loader keeps one session for a
 *   temp staging table and its `set` statements; the pooler's transaction mode
 *   (port 6543) hands the connection to someone else between statements and
 *   silently breaks both. Port 6543 is refused by name.
 *
 *   Not the direct host. `db.<ref>.supabase.co` resolves to IPv6 only, which
 *   GitHub's hosted runners cannot reach; the session pooler is the IPv4 path.
 *   Refused by name, so the mistake reads as a sentence and not as ENETUNREACH.
 */

import type { Options } from "postgres";

/** Hostnames of the IPv6-only direct connection. */
const DIRECT_HOST = /^db\.[a-z0-9]+\.supabase\.co$/i;

export const LOADER_STATEMENT_TIMEOUT = "10min";
export const LOADER_LOCK_TIMEOUT = "5s";

/**
 * Turns the secret into driver options, or throws a sentence saying what is
 * wrong with it. Never echoes the password.
 */
export function connectionOptions(raw: string, caPem?: string): Options<Record<string, never>> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "SCRYFALL_SYNC_DATABASE_URL is not a valid URL. Expected " +
        "postgresql://scryfall_loader.<project-ref>:<password>@<pooler-host>:5432/postgres",
    );
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("SCRYFALL_SYNC_DATABASE_URL must be a postgresql:// URL");
  }
  if (!url.username || !url.password) {
    throw new Error("SCRYFALL_SYNC_DATABASE_URL must include a user and a password");
  }
  if (DIRECT_HOST.test(url.hostname)) {
    throw new Error(
      `SCRYFALL_SYNC_DATABASE_URL points at ${url.hostname}, the IPv6-only direct host, which ` +
        "GitHub's runners cannot reach. Use the SESSION POOLER host (aws-...pooler.supabase.com, " +
        "port 5432) with user scryfall_loader.<project-ref>.",
    );
  }
  if (url.port === "6543") {
    throw new Error(
      "SCRYFALL_SYNC_DATABASE_URL uses port 6543, the pooler's transaction mode, which does not " +
        "keep a session between statements and would break the staging table. Use port 5432 " +
        "(session mode).",
    );
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    // An object, never 'require': see the header. tls.connect's own default
    // (rejectUnauthorized: true) then applies, and servername is set by the
    // driver from the host so the certificate name is checked too.
    ssl: caPem ? { rejectUnauthorized: true, ca: caPem } : { rejectUnauthorized: true },
    // One connection: the staging table is per-session, and the loader is
    // sequential by design.
    max: 1,
    // Session mode supports prepared statements, but nothing here repeats a
    // statement often enough to benefit and unprepared is safe in either mode.
    prepare: false,
    // Deliberately NOT `fetch_types: false`, however tempting for one less
    // round trip: with it off, postgres.js's reserve() never resolves against
    // a max-1 pool (found by running the loader, which hung silently).
    connect_timeout: 30,
    // Never recycle mid-run: the session is the staging table's lifetime.
    max_lifetime: null,
    idle_timeout: 0,
    onnotice: () => {},
  };
}
