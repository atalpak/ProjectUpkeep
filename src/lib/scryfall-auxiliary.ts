/** Pure validation and mapping for Scryfall's oracle_tags and rulings feeds. */
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a Scryfall object");
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${field}`);
  return value.replaceAll("\u0000", "");
}

function uuid(value: unknown, field: string): string {
  const text = nonempty(value, field);
  if (!UUID.test(text)) throw new Error(`Invalid ${field}`);
  return text.toLowerCase();
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((part) => typeof part !== "string")) {
    throw new Error(`Invalid ${field}`);
  }
  return value.map((part: string) => part.replaceAll("\u0000", ""));
}

function uuids(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${field}`);
  return value.map((part: unknown) => uuid(part, field));
}

export type OracleTag = {
  id: string;
  label: string;
  slug: string;
  description: string | null;
  uri: string | null;
  aliases: string[];
  parent_ids: string[];
  child_ids: string[];
  taggings: Array<{ oracle_id: string; weight: string }>;
};

export function toOracleTag(value: unknown): OracleTag {
  const source = record(value);
  if (source.object !== "tag" || source.type !== "oracle") {
    throw new Error("Expected an oracle tag");
  }
  if (!Array.isArray(source.taggings)) throw new Error("Invalid taggings");
  const seen = new Set<string>();
  const taggings = source.taggings.map((value: unknown) => {
    const tagging = record(value);
    const oracle_id = uuid(tagging.oracle_id, "tagging.oracle_id");
    if (seen.has(oracle_id)) throw new Error("Duplicate oracle ID within tag");
    seen.add(oracle_id);
    return { oracle_id, weight: nonempty(tagging.weight, "tagging.weight") };
  });
  return {
    id: uuid(source.id, "tag.id"),
    label: nonempty(source.label, "tag.label"),
    slug: nonempty(source.slug, "tag.slug"),
    description: source.description == null ? null : String(source.description).replaceAll("\u0000", ""),
    uri: source.uri == null ? null : nonempty(source.uri, "tag.uri"),
    aliases: strings(source.aliases, "tag.aliases"),
    parent_ids: uuids(source.parent_ids, "tag.parent_ids"),
    child_ids: uuids(source.child_ids, "tag.child_ids"),
    taggings,
  };
}

export type OracleRuling = {
  content_hash: string;
  oracle_id: string;
  source: string;
  published_at: string;
  comment: string;
};

export function toOracleRuling(value: unknown): OracleRuling {
  const source = record(value);
  if (source.object !== "ruling") throw new Error("Expected a ruling");
  const oracle_id = uuid(source.oracle_id, "ruling.oracle_id");
  const rulingSource = nonempty(source.source, "ruling.source");
  const published_at = nonempty(source.published_at, "ruling.published_at");
  const parsedDate = new Date(`${published_at}T00:00:00Z`);
  if (!DATE.test(published_at) || Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== published_at) {
    throw new Error("Invalid ruling.published_at");
  }
  // Scryfall has two historical rulings whose comment is a single nonbreaking
  // space. Preserve their source text rather than treating it as a bad feed.
  if (typeof source.comment !== "string" || source.comment.length === 0) {
    throw new Error("Missing ruling.comment");
  }
  const comment = source.comment.replaceAll("\u0000", "");
  const content_hash = createHash("sha256")
    .update(JSON.stringify([oracle_id, rulingSource, published_at, comment]))
    .digest("hex");
  return { content_hash, oracle_id, source: rulingSource, published_at, comment };
}

/** A short feed must never reach the transaction that deletes missing rows. */
export function checkAuxiliaryFeedSize(
  label: string,
  incoming: number,
  stored: number,
  minimum: number,
): void {
  if (incoming < minimum || (stored >= minimum && incoming < stored * 0.9)) {
    throw new Error(
      `${label} feed has only ${incoming.toLocaleString()} rows ` +
        `(minimum ${minimum.toLocaleString()}, currently stored ${stored.toLocaleString()}); ` +
        "refusing to remove existing catalog data",
    );
  }
}
