"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui";

type TagOption = { id: string; label: string; slug: string };

export function OracleTagPicker({
  selectedId,
  initialLabel,
  onChange,
  inputLabel = "Oracle tag",
}: {
  selectedId: string;
  initialLabel: string;
  onChange: (id: string, label: string, slug: string) => void;
  inputLabel?: string;
}) {
  const [query, setQuery] = useState(initialLabel);
  const [results, setResults] = useState<TagOption[]>([]);
  const [error, setError] = useState("");
  const [syncedLabel, setSyncedLabel] = useState(initialLabel);

  if (syncedLabel !== initialLabel) {
    setSyncedLabel(initialLabel);
    setQuery(initialLabel);
  }

  useEffect(() => {
    if (selectedId || query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error: searchError } = await createClient()
        .from("oracle_tags")
        .select("id,label,slug")
        .ilike("label", `%${query.trim()}%`)
        .order("label")
        .limit(12);
      if (cancelled) return;
      setResults((data ?? []) as TagOption[]);
      setError(searchError ? "Tags could not be loaded." : "");
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selectedId]);

  return (
    <div className="relative space-y-1">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setResults([]);
          setError("");
          setSyncedLabel("");
          onChange("", "", "");
        }}
        placeholder="Search card roles or themes"
        aria-label={inputLabel}
        autoComplete="off"
      />
      {selectedId ? (
        <button
          type="button"
          className="text-xs text-accent-text underline"
          onClick={() => { setQuery(""); setSyncedLabel(""); onChange("", "", ""); }}
        >
          Clear tag
        </button>
      ) : query.trim().length >= 2 ? (
        <div className="absolute z-20 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-surface-raised shadow-lg">
          {error ? <p className="p-2 text-xs text-danger">{error}</p> : null}
          {!error && results.length === 0 ? (
            <p className="p-2 text-xs text-ink-muted">Choose a tag from the results.</p>
          ) : null}
          {results.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-surface-muted"
              onClick={() => {
                setQuery(tag.label);
                setResults([]);
                setSyncedLabel(tag.label);
                onChange(tag.id, tag.label, tag.slug);
              }}
            >
              {tag.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
