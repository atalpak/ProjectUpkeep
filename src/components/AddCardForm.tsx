"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Image from "next/image";

import { addCardInstance, EMPTY_STATE } from "@/app/(app)/collection/actions";
import {
  Banner,
  Button,
  Card as Panel,
  Field,
  Input,
  Select,
  cx,
} from "@/components/ui";
import {
  CONDITIONS,
  CONDITION_LABELS,
  FINISH_LABELS,
  LANGUAGES,
  type CardNameSuggestion,
  type Card,
  type Finish,
  type Location,
} from "@/lib/types";

type Printing = Pick<
  Card,
  | "scryfall_id"
  | "name"
  | "set_code"
  | "set_name"
  | "collector_number"
  | "rarity"
  | "released_at"
  | "image_uri"
  | "image_uri_small"
  | "available_finishes"
  | "lang"
>;

/**
 * The add-card flow, in three steps: find a name, pick the printing, describe
 * the physical copy.
 *
 * Splitting name from printing matters because a popular card has dozens of
 * printings — asking someone to scroll them before they have even said which
 * card they mean is the mistake most collection tools make.
 */
export function AddCardForm({ locations }: { locations: Location[] }) {
  const [state, action, pending] = useActionState(addCardInstance, EMPTY_STATE);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CardNameSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [printings, setPrintings] = useState<Printing[]>([]);
  const [printing, setPrinting] = useState<Printing | null>(null);

  // Clear the form after each successful add. Keyed off the action state's
  // nonce rather than its message, so adding the same card twice in a row —
  // which produces identical text — still resets.
  const lastNonce = useRef(state.nonce);

  useEffect(() => {
    if (!state.nonce || state.nonce === lastNonce.current) return;
    lastNonce.current = state.nonce;
    setQuery("");
    setSuggestions([]);
    setSelectedName(null);
    setPrintings([]);
    setPrinting(null);
  }, [state.nonce]);

  // --- Step 1: name autocomplete -------------------------------------------
  useEffect(() => {
    if (selectedName !== null) return;
    const trimmed = query.trim();
    // Below the threshold there is nothing to fetch; the input handler has
    // already cleared any stale suggestions.
    if (trimmed.length < 2) return;

    // Debounce, and abort the in-flight request when the query moves on, so
    // slow responses cannot land out of order and overwrite newer results.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (res.status === 401) {
          setSearchError("Your session expired. Reload the page and sign in again.");
          return;
        }
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const body = (await res.json()) as { results: CardNameSuggestion[] };
        setSuggestions(body.results);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSearchError(
            "Could not search cards. If no cards are found at all, the card " +
              "database may not be populated yet — run the Scryfall sync.",
          );
        }
      } finally {
        setSearching(false);
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, selectedName]);

  // --- Step 2: printings for the chosen name -------------------------------
  async function chooseName(name: string) {
    setSelectedName(name);
    setQuery(name);
    setSuggestions([]);
    setSearching(true);
    try {
      const res = await fetch(`/api/cards/printings?name=${encodeURIComponent(name)}`);
      const body = (await res.json()) as { printings: Printing[] };
      setPrintings(body.printings);
      setPrinting(body.printings[0] ?? null);
    } catch {
      setSearchError("Could not load printings for that card.");
    } finally {
      setSearching(false);
    }
  }

  function reset() {
    setSelectedName(null);
    setPrintings([]);
    setPrinting(null);
    setQuery("");
  }

  const finishes = (printing?.available_finishes?.length
    ? printing.available_finishes
    : ["nonfoil"]) as Finish[];

  return (
    <div className="space-y-6">
      {/* ---- Step 1 ---- */}
      <Panel>
        <Field label="Card name" hint="Type at least two characters.">
          <Input
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              if (value.trim().length < 2) setSuggestions([]);
              if (selectedName) reset();
            }}
            placeholder="Lightning Bolt"
            autoFocus
            aria-label="Search for a card by name"
          />
        </Field>

        {searching ? (
          <p className="mt-2 text-sm text-[--color-ink-muted]">Searching…</p>
        ) : null}

        {searchError ? (
          <div className="mt-2">
            <Banner kind="error">{searchError}</Banner>
          </div>
        ) : null}

        {suggestions.length > 0 ? (
          <ul className="mt-3 divide-y divide-[--color-border] rounded-md border border-[--color-border]">
            {suggestions.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => chooseName(s.name)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-[--color-surface-muted]"
                >
                  {s.sample_image_uri ? (
                    <Image
                      src={s.sample_image_uri}
                      alt=""
                      width={30}
                      height={42}
                      className="rounded-sm"
                      unoptimized
                    />
                  ) : (
                    <span className="h-[42px] w-[30px] rounded-sm bg-[--color-surface-muted]" />
                  )}
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-auto text-xs text-[--color-ink-muted]">
                    {s.printing_count} printing{s.printing_count === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {/* ---- Steps 2 and 3 ---- */}
      {selectedName && printing ? (
        <form action={action} className="space-y-6">
          <input type="hidden" name="card_id" value={printing.scryfall_id} />
          <input type="hidden" name="card_name" value={printing.name} />

          <Panel>
            <div className="flex items-start gap-4">
              {printing.image_uri ? (
                <Image
                  src={printing.image_uri}
                  alt={printing.name}
                  width={146}
                  height={204}
                  className="rounded-md"
                  unoptimized
                />
              ) : null}

              <div className="flex-1 space-y-3">
                <div>
                  <h2 className="font-medium">{printing.name}</h2>
                  <p className="text-sm text-[--color-ink-muted]">
                    {printing.set_name ?? printing.set_code.toUpperCase()} ·{" "}
                    {printing.collector_number}
                    {printing.rarity ? ` · ${printing.rarity}` : ""}
                  </p>
                </div>

                <Field label={`Printing (${printings.length})`}>
                  <Select
                    value={printing.scryfall_id}
                    onChange={(e) =>
                      setPrinting(
                        printings.find((p) => p.scryfall_id === e.target.value) ?? null,
                      )
                    }
                  >
                    {printings.map((p) => (
                      <option key={p.scryfall_id} value={p.scryfall_id}>
                        {(p.set_name ?? p.set_code.toUpperCase()) +
                          ` · #${p.collector_number}` +
                          (p.released_at ? ` · ${p.released_at.slice(0, 4)}` : "")}
                      </option>
                    ))}
                  </Select>
                </Field>

                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-[--color-accent] underline"
                >
                  Search for a different card
                </button>
              </div>
            </div>
          </Panel>

          <Panel className="space-y-4">
            <h3 className="text-sm font-medium">Your copy</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Condition">
                <Select name="condition" defaultValue="NM">
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONDITION_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Finish"
                hint={
                  finishes.length === 1
                    ? "This printing only exists in one finish."
                    : undefined
                }
              >
                <Select name="finish" defaultValue={finishes[0]}>
                  {finishes.map((f) => (
                    <option key={f} value={f}>
                      {FINISH_LABELS[f] ?? f}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Language"
                hint="The language of your physical card."
              >
                <Select name="language" defaultValue={printing.lang || "en"}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Quantity">
                <Input name="quantity" type="number" min={1} max={10000} defaultValue={1} />
              </Field>

              <Field label="Location" hint="Leave unsorted if you haven't filed it yet.">
                <Select name="location_id" defaultValue="">
                  <option value="">Unsorted</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Notes" hint="Optional. A card with a note is never merged into a stack.">
                <Input name="notes" maxLength={500} placeholder="Signed, misprint…" />
              </Field>
            </div>

            <Banner kind="error">{state.error}</Banner>
            <Banner kind="success">{state.notice}</Banner>

            <Button type="submit" disabled={pending} className={cx(pending && "opacity-60")}>
              {pending ? "Adding…" : "Add to collection"}
            </Button>
          </Panel>
        </form>
      ) : null}

      {/* A success message still needs somewhere to land after the form resets. */}
      {!selectedName && state.notice ? <Banner kind="success">{state.notice}</Banner> : null}
    </div>
  );
}
