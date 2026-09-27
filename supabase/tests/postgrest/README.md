# Local card API contract

These fixtures are public catalog rows and two fake users. Run only after
`npm run test:db`, against that disposable database. Do not load them into a
linked Supabase project. The HTTP probe uses a fixed local-only JWT signing
secret and only connects to `127.0.0.1:3009`.

With PostgreSQL on port 55436 and PostgREST 14.5 installed (production's version;
the same checks also passed on 16.4):

```sh
psql -h127.0.0.1 -p55436 -Upostgres -d mtg_verify -v ON_ERROR_STOP=1 -f supabase/tests/postgrest/fixtures.sql
postgrest supabase/tests/postgrest/local.conf
# From another terminal:
python3 supabase/tests/postgrest/card_contract.py
```

Adjust the local database connection in `local.conf` for another scratch port.
The 26 assertions cover direct reads, to-one embeddings, `!inner`, child
filters, commander FK hints, cross-user and anonymous isolation, shared-field
nulls/arrays, RPC authorization, and blocked direct printing inserts.
