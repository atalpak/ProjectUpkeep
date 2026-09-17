-- Read-only JSONL export. Run with psql -At -f, using existing server-side credentials.
select jsonb_build_object(
  'id', id, 'oracle_id', oracle_id, 'name', name, 'flavor_name', flavor_name,
  'set_code', set_code, 'collector_number', collector_number,
  'available_finishes', available_finishes, 'lang', lang,
  'image_uri', image_uri, 'digital', digital
)
from public.cards
where digital = false and oracle_id is not null
order by id;
