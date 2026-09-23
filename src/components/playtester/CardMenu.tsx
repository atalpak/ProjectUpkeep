"use client";

import { useState } from "react";

import { FloatingMenu } from "@/components/FloatingMenu";
import { Button, Field, Input } from "@/components/ui";
import type { GameCommand } from "@/lib/playtest/board/commands";
import type { GameCard as GameCardModel, ZoneId } from "@/lib/playtest/board/types";

/**
 * The action menu every card needs (plan section 3.3/3.4) — the *primary*
 * path to every card action, not a convenience layered over drag. Every
 * pointer or keyboard entry point into a card (click-then-Enter, the visible
 * "Actions" button, `Hand.tsx`'s keyboard "Move" flow) opens this same menu,
 * so there is exactly one place the available actions for a card are decided.
 *
 * Every item dispatches one command from `src/lib/playtest/board/commands.ts`
 * — nothing here computes new game state itself.
 */
export function CardMenu({
  card,
  zone,
  groupIds,
  dispatch,
  open,
  onOpenChange,
  trigger,
}: {
  card: GameCardModel;
  zone: ZoneId;
  /** Existing battlefield group ids, for "Move to group ..." — excludes `null`
   *  (ungrouped), which always gets its own fixed item. */
  groupIds: string[];
  dispatch: (command: GameCommand) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (state: { toggle: () => void; setTriggerRef: (el: HTMLElement | null) => void }) => React.ReactNode;
}) {
  const [counterName, setCounterName] = useState("+1/+1");
  const [note, setNote] = useState(card.note ?? "");

  const onBattlefield = zone === "battlefield";

  return (
    <FloatingMenu
      open={open}
      onOpenChange={onOpenChange}
      align="left"
      panelClassName="w-64 rounded-lg border border-border bg-surface-raised p-2 shadow-xl"
      trigger={({ toggle, setTriggerRef }) => trigger({ toggle, setTriggerRef })}
    >
      {({ close }) => (
        <div className="space-y-1 text-sm" role="menu" aria-label={`Actions for ${card.name}`}>
          {onBattlefield ? (
            <MenuButton
              onClick={() => {
                dispatch({ type: "SET_TAPPED", cardId: card.id, tapped: !card.tapped });
                close();
              }}
            >
              {card.tapped ? "Untap" : "Tap"}
            </MenuButton>
          ) : null}

          {onBattlefield ? (
            <MenuButton
              onClick={() => {
                const next = ((card.rotation + 90) % 360) as 0 | 90 | 180 | 270;
                dispatch({ type: "SET_ROTATION", cardId: card.id, rotation: next });
                close();
              }}
            >
              Rotate 90°
            </MenuButton>
          ) : null}

          {onBattlefield ? (
            <MenuButton
              onClick={() => {
                dispatch({ type: "SET_FACE", cardId: card.id, face: card.face === "back" ? "front" : "back" });
                close();
              }}
            >
              {card.face === "back" ? "Turn face up" : "Flip to back face"}
            </MenuButton>
          ) : null}

          {onBattlefield ? (
            <MenuButton
              onClick={() => {
                dispatch({ type: "SET_FACE", cardId: card.id, face: card.face === "face-down" ? "front" : "face-down" });
                close();
              }}
            >
              {card.face === "face-down" ? "Turn face up" : "Turn face down"}
            </MenuButton>
          ) : null}

          {onBattlefield ? (
            <MenuButton
              onClick={() => {
                const id = `${card.id}:copy:${Date.now()}`;
                dispatch({
                  type: "CREATE_TOKEN",
                  ids: [id],
                  token: { name: `Copy of ${card.name}`, power: card.power, toughness: card.toughness, imageUri: card.imageUri },
                  zone: "battlefield",
                });
                close();
              }}
            >
              Copy
            </MenuButton>
          ) : null}

          {onBattlefield ? <Divider /> : null}

          {onBattlefield ? (
            <div className="flex items-end gap-1.5 px-1 py-1">
              <div className="min-w-0 flex-1">
                <Field label="Counter">
                  <Input value={counterName} onChange={(e) => setCounterName(e.target.value)} placeholder="+1/+1" />
                </Field>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  if (!counterName.trim()) return;
                  dispatch({ type: "ADD_COUNTER", cardId: card.id, name: counterName.trim(), delta: 1 });
                }}
              >
                +1
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  if (!counterName.trim()) return;
                  dispatch({ type: "ADD_COUNTER", cardId: card.id, name: counterName.trim(), delta: -1 });
                }}
              >
                -1
              </Button>
            </div>
          ) : null}

          {onBattlefield ? (
            <div className="flex items-end gap-1.5 px-1 py-1">
              <div className="min-w-0 flex-1">
                <Field label="Note">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. targets me" />
                </Field>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  dispatch({ type: "SET_NOTE", cardId: card.id, note: note.trim() || null });
                  close();
                }}
              >
                Save
              </Button>
            </div>
          ) : null}

          {onBattlefield ? <Divider /> : null}

          {onBattlefield ? (
            <>
              <p className="px-1 pt-1 text-xs font-medium text-ink-muted">Group</p>
              <MenuButton
                onClick={() => {
                  dispatch({ type: "MOVE_CARD", cardId: card.id, to: "battlefield", index: null, groupId: null });
                  close();
                }}
              >
                Ungrouped
              </MenuButton>
              {groupIds.map((groupId) => (
                <MenuButton
                  key={groupId}
                  onClick={() => {
                    dispatch({ type: "MOVE_CARD", cardId: card.id, to: "battlefield", index: null, groupId });
                    close();
                  }}
                >
                  Move to {groupId}
                </MenuButton>
              ))}
              <MenuButton
                onClick={() => {
                  const groupId = `Group ${groupIds.length + 1}`;
                  dispatch({ type: "MOVE_CARD", cardId: card.id, to: "battlefield", index: null, groupId });
                  close();
                }}
              >
                New group…
              </MenuButton>
              <Divider />
            </>
          ) : null}

          <p className="px-1 pt-1 text-xs font-medium text-ink-muted">Move to</p>
          {ZONE_DESTINATIONS.filter((z) => z.id !== zone).map((z) => (
            <MenuButton
              key={z.id}
              onClick={() => {
                dispatch({ type: "MOVE_CARD", cardId: card.id, to: z.id, index: z.index ?? null, groupId: null });
                close();
              }}
            >
              {z.label}
            </MenuButton>
          ))}

          {zone !== "battlefield" ? (
            <MenuButton
              onClick={() => {
                dispatch({ type: "MOVE_CARD", cardId: card.id, to: "battlefield", index: null, groupId: null });
                close();
              }}
            >
              Battlefield
            </MenuButton>
          ) : null}

          <Divider />
          <MenuButton
            danger
            onClick={() => {
              dispatch({ type: "DELETE_OBJECT", cardId: card.id });
              close();
            }}
          >
            Remove from game
          </MenuButton>
        </div>
      )}
    </FloatingMenu>
  );
}

function Divider() {
  return <div className="my-1 border-t border-border" />;
}

function MenuButton({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={
        "block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-muted coarse:min-h-11 " +
        (danger ? "text-danger-text" : "text-ink")
      }
    >
      {children}
    </button>
  );
}

const ZONE_DESTINATIONS: Array<{ id: ZoneId; label: string; index?: number }> = [
  { id: "hand", label: "Hand" },
  { id: "library", label: "Top of library", index: 0 },
  { id: "graveyard", label: "Graveyard" },
  { id: "exile", label: "Exile" },
  { id: "command", label: "Command zone" },
];
