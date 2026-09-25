"use client";

import { memo, useState } from "react";

import { usePlayStore } from "@/components/playtester/hooks/useStore";
import { FloatingMenu } from "@/components/FloatingMenu";
import type { GroupArrangement } from "@/lib/playtest/board/types";

/**
 * The dashed frame and label around a group. The frame itself ignores the
 * pointer (cards inside it stay draggable); only the label chip is interactive,
 * and it opens a small menu (arrangement, rename, ungroup), so a group can be
 * managed without any drag at all. Positions inside a group are derived from
 * its anchor + arrangement, never stored, which is why "arrange as column" is
 * one `SET_GROUP` and the cards simply follow.
 */
export const GroupFrame = memo(function GroupFrame({
  groupId,
  label,
  arrangement,
  x,
  y,
  w,
  h,
}: {
  groupId: string;
  label: string;
  arrangement: GroupArrangement;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const store = usePlayStore();
  const [draft, setDraft] = useState(label);

  function members(): string[] {
    const game = store.get().game;
    return game ? game.zones.battlefield.filter((id) => game.cards[id]?.groupId === groupId) : [];
  }

  return (
    <div
      className="pointer-events-none absolute rounded-lg border border-dashed border-white/35 bg-white/[0.03]"
      style={{ left: `${x * 100 - 0.6}%`, top: `${y * 100 - 0.9}%`, width: `${w * 100 + 1.2}%`, height: `${h * 100 + 1.8}%`, zIndex: 0 }}
    >
      <div className="pointer-events-auto absolute -top-[1px] left-2 -translate-y-full">
        <FloatingMenu
          align="left"
          trigger={({ toggle, setTriggerRef, open }) => (
            <button
              ref={setTriggerRef}
              type="button"
              onClick={toggle}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`Group ${label}: options`}
              className="rounded-t-md bg-surface-inverse/80 px-2 py-0.5 text-[11px] font-medium text-inverse hover:bg-surface-inverse coarse:min-h-11"
            >
              {label} <span aria-hidden="true">·</span> <span className="opacity-70">{arrangement}</span>
            </button>
          )}
          panelClassName="w-56 rounded-xl border border-border bg-surface-raised p-2 text-sm text-ink shadow-[var(--shadow-raised)]"
        >
          {({ close }) => (
            <div role="menu" aria-label={`Group ${label}`} className="space-y-1">
              <p className="px-1 text-xs font-medium text-ink-muted">Arrange</p>
              <div className="grid grid-cols-3 gap-1">
                {(["row", "column", "stack"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    role="menuitemradio"
                    aria-checked={a === arrangement}
                    onClick={() => {
                      store.dispatch({ type: "SET_GROUP", ids: [], groupId, group: { arrangement: a } });
                      close();
                    }}
                    className={`rounded-md border px-2 py-1 text-xs capitalize coarse:min-h-11 ${a === arrangement ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-muted"}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <label className="block px-1 pt-1 text-xs font-medium text-ink-muted">
                Name
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      store.dispatch({ type: "SET_GROUP", ids: [], groupId, group: { label: draft } });
                      close();
                    }
                  }}
                  maxLength={60}
                  className="mt-0.5 w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-sm text-ink coarse:min-h-11"
                />
              </label>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  store.dispatch({ type: "SET_GROUP", ids: [], groupId, group: { label: draft } });
                  close();
                }}
                className="w-full rounded-md px-2 py-1 text-left hover:bg-surface-muted coarse:min-h-11"
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  store.setSelection(members());
                  close();
                }}
                className="w-full rounded-md px-2 py-1 text-left hover:bg-surface-muted coarse:min-h-11"
              >
                Select the group
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  store.dispatch({ type: "SET_GROUP", ids: members(), groupId: null });
                  close();
                }}
                className="w-full rounded-md px-2 py-1 text-left text-danger-text hover:bg-surface-muted coarse:min-h-11"
              >
                Ungroup
              </button>
            </div>
          )}
        </FloatingMenu>
      </div>
    </div>
  );
});
