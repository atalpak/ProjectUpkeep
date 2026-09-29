export const CARD_DRAG_TYPE = "application/x-upkeep-card";

export type CardDrag =
  | { kind: "catalog"; cardId: string; name: string; local: boolean }
  | { kind: "copy"; instanceId: string; name: string };

export function readCardDrag(transfer: DataTransfer): CardDrag | null {
  try {
    const value: unknown = JSON.parse(transfer.getData(CARD_DRAG_TYPE));
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (item.kind === "catalog" && typeof item.cardId === "string" && typeof item.name === "string" && typeof item.local === "boolean") {
      return { kind: "catalog", cardId: item.cardId, name: item.name, local: item.local };
    }
    if (item.kind === "copy" && typeof item.instanceId === "string" && typeof item.name === "string") {
      return { kind: "copy", instanceId: item.instanceId, name: item.name };
    }
  } catch { /* Other dragged content has no Upkeep card payload. */ }
  return null;
}
