"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Ruling = { content_hash: string; source: string; published_at: string; comment: string };

/** Load rulings only when the reader opens the section. */
export function CardRulings({ oracleId }: { oracleId: string | null }) {
  const [rulings, setRulings] = useState<Ruling[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  if (!oracleId) return null;

  async function load() {
    if (rulings || loading) return;
    setLoading(true);
    const result = await createClient()
      .from("oracle_rulings")
      .select("content_hash,source,published_at,comment")
      .eq("oracle_id", oracleId)
      .order("published_at", { ascending: false });
    setLoading(false);
    if (result.error) setError(true);
    else { setRulings((result.data ?? []) as Ruling[]); setError(false); }
  }

  return (
    <details
      className="border-t border-border pt-2 text-xs"
      onToggle={(event) => { if (event.currentTarget.open) void load(); }}
    >
      <summary className="cursor-pointer font-semibold">Rulings</summary>
      <div className="mt-2 space-y-2">
        {loading ? <p className="text-ink-muted">Loading rulings…</p> : null}
        {error ? <p className="text-danger-text">Rulings are unavailable right now.</p> : null}
        {rulings?.length === 0 ? <p className="text-ink-muted">No rulings recorded.</p> : null}
        {rulings?.map((ruling) => (
          <div key={ruling.content_hash} className="space-y-1 border-l-2 border-border pl-2">
            <p className="whitespace-pre-line leading-relaxed">{ruling.comment}</p>
            <p className="text-ink-muted">{ruling.published_at} · {ruling.source === "wotc" ? "Wizards of the Coast" : "Scryfall"}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
