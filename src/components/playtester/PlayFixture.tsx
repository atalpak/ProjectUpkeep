"use client";

import { PlayBoard } from "./PlayBoard";
import type { StartEntry } from "@/lib/playtest/slim";

/** Development-only sample. No account, deck query, or card API is needed. */
const entries: StartEntry[] = Array.from({ length: 60 }, (_, i) => ({ id: `fixture-${i}`, card_id: `fixture-${i}`, quantity: 1, cards: { scryfall_id: `fixture-${i}`, oracle_id: `fixture-oracle-${i}`, name: i % 5 === 0 ? `Fixture Land ${i}` : `Fixture Spell ${i}`, type_line: i % 5 === 0 ? "Basic Land" : "Creature", cmc: i % 5, colors: [], mana_cost: null, produced_mana: i % 5 === 0 ? ["G"] : null, oracle_text: "This is sample data for the development playtester.", image_uri: null, image_uri_small: null, power: i % 5 === 0 ? null : "2", toughness: i % 5 === 0 ? null : "2", loyalty: null, card_faces: null } }));
export function PlayFixture() { return <PlayBoard deckId="fixture-deck" deckName="Fixture deck" userId="dev-fixture" fingerprint={"0".repeat(64)} entries={entries} commanderCardId={null} saves={{ available: false, sessions: [], shares: [] }} initialSession={null} actions={null} />; }
