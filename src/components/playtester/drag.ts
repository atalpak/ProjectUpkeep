/**
 * Pointer drag for the table, written as plain functions over the DOM and the
 * stores (no drag library, per the architect map).
 *
 * The performance rule: while a card is being dragged NOTHING goes through a
 * store. The pointer handler works out the movement, snaps it, and writes a
 * `translate3d` straight to the moving elements inside a requestAnimationFrame,
 * so a drag costs a transform per frame and zero React renders. Only the drop
 * does anything durable, and it does exactly ONE command (a `BATCH` when it is
 * a group move plus a re-stack), so a drag is one undo step however far it went.
 * Only the small `ui` store hears about a drag in flight (which drop target is
 * under the pointer, where the alignment guides go), because the highlights
 * need it.
 *
 * Dragging is one way to move a card among several. Every move here also has a
 * menu item and a keyboard path (CardMenu, the shortcut layer, arrow-key
 * nudging); a pointer is never the only way to do anything.
 *
 * A grouped card drags its WHOLE group (the group's anchor moves; member
 * positions are derived, never stored). Hold Shift or Alt to pull just that one
 * card out of its group.
 */

import type { PlayStore } from "@/components/playtester/store";
import type { UiStore } from "@/components/playtester/ui-store";
import type { GameCommand } from "@/lib/playtest/board/commands";
import { CARD_H, CARD_W, cardsInRect, clampPos, resolvedPositions, snapPosition } from "@/lib/playtest/board/layout";
import type { Pos, ZoneId } from "@/lib/playtest/board/types";

export type DropTarget = ZoneId | "battlefield" | "hand";

export const DROP_LABELS: Record<string, string> = {
  battlefield: "Battlefield",
  hand: "Hand",
  graveyard: "Graveyard",
  exile: "Exile",
  library: "Top of library",
  command: "Command zone",
  temporary: "Stack",
  sideboard: "Sideboard",
};

const DRAG_THRESHOLD_PX = 5;
const LONG_PRESS_MS = 450;

export type BoardHost = {
  store: PlayStore;
  ui: UiStore;
  board: () => HTMLElement | null;
  /** Battlefield card wrappers, by object id. */
  els: Map<string, HTMLElement>;
  marquee: () => HTMLElement | null;
  reducedMotion: () => boolean;
};

function dropTargetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  const target = el instanceof Element ? el.closest<HTMLElement>("[data-drop]") : null;
  return (target?.dataset.drop as DropTarget | undefined) ?? null;
}

/** The command a drop onto a zone stands for. */
export function dropCommand(ids: string[], zone: DropTarget): GameCommand {
  return { type: "MOVE_MANY", ids, to: zone as ZoneId, at: zone === "library" ? "top" : "bottom" };
}

function setUi(ui: UiStore, patch: Partial<ReturnType<UiStore["get"]>>) {
  ui.set((s) => {
    const keys = Object.keys(patch) as Array<keyof typeof patch>;
    if (keys.every((k) => s[k] === patch[k])) return s;
    return { ...s, ...patch };
  });
}

type Mover = { id: string; el: HTMLElement; orig: Pos };

export function createBoardDrag(host: BoardHost) {
  const { store, ui } = host;

  function onCardPointerDown(event: PointerEvent | React.PointerEvent, id: string) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const game = store.get().game;
    const boardEl = host.board();
    if (!game || !boardEl) return;

    const start = { x: event.clientX, y: event.clientY };
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const detach = event.shiftKey || event.altKey;
    const selectionBefore = store.get().selection;
    const wasSelected = selectionBefore.includes(id);
    if (!wasSelected) store.setSelection(additive ? [...selectionBefore, id] : [id]);

    let dragging = false;
    let raf = 0;
    let pointer = { x: start.x, y: start.y, alt: false };
    const movers: Mover[] = [];
    const groupAnchors = new Map<string, Pos>();
    let others: Pos[] = [];
    let rect: DOMRect | null = null;
    let delta = { dx: 0, dy: 0 };
    let hover: DropTarget | null = null;

    const longPress = window.setTimeout(() => {
      if (!dragging) setUi(ui, { inspect: { cardId: id, big: true } });
    }, LONG_PRESS_MS);

    function begin() {
      window.clearTimeout(longPress);
      setUi(ui, { inspect: null });
      const state = store.get();
      const g = state.game;
      rect = boardEl!.getBoundingClientRect();
      if (!g || rect.width === 0) return;
      const positions = resolvedPositions(g);
      const chosen = state.selection.includes(id) ? [...state.selection] : [id];
      const moveSet = new Set<string>();
      for (const cid of chosen) {
        const card = g.cards[cid];
        if (!card) continue;
        if (card.groupId && !detach) {
          for (const memberId of g.zones.battlefield) if (g.cards[memberId]?.groupId === card.groupId) moveSet.add(memberId);
          const group = g.groups[card.groupId];
          if (group) groupAnchors.set(card.groupId, group.anchor);
        } else {
          moveSet.add(cid);
        }
      }
      for (const cid of moveSet) {
        const el = host.els.get(cid);
        const orig = positions.get(cid);
        if (el && orig) movers.push({ id: cid, el, orig });
      }
      others = [];
      for (const [cid, pos] of positions) if (!moveSet.has(cid)) others.push(pos);
      for (const m of movers) {
        m.el.dataset.dragging = "1";
        m.el.style.willChange = "transform";
        m.el.style.zIndex = "1000";
      }
      dragging = true;
      setUi(ui, { dragging: true });
    }

    function apply() {
      raf = 0;
      if (!rect || movers.length === 0) return;
      const primary = movers.find((m) => m.id === id) ?? movers[0];
      let dx = (pointer.x - start.x) / rect.width;
      let dy = (pointer.y - start.y) / rect.height;
      const target = dropTargetAt(pointer.x, pointer.y);
      hover = target && target !== "battlefield" ? target : null;
      let guides: { x: number | null; y: number | null } = { x: null, y: null };
      if (!hover && !pointer.alt) {
        const snapped = snapPosition(clampPos({ x: primary.orig.x + dx, y: primary.orig.y + dy }), others);
        dx = snapped.pos.x - primary.orig.x;
        dy = snapped.pos.y - primary.orig.y;
        guides = { x: snapped.guideX, y: snapped.guideY };
      }
      delta = { dx, dy };
      const px = dx * rect.width;
      const py = dy * rect.height;
      for (const m of movers) m.el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      setUi(ui, { hoverZone: hover, guides });
    }

    function onMove(ev: PointerEvent) {
      pointer = { x: ev.clientX, y: ev.clientY, alt: ev.altKey };
      if (!dragging) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD_PX) return;
        begin();
      }
      if (!raf) raf = requestAnimationFrame(apply);
    }

    function finish(cancelled: boolean) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.clearTimeout(longPress);
      if (raf) cancelAnimationFrame(raf);
      const inspecting = ui.get().inspect;
      if (inspecting?.big) setUi(ui, { inspect: null });

      if (!dragging) {
        // A press without movement is a click.
        if (!cancelled && wasSelected && !additive && store.get().selection.length > 1) store.setSelection([id]);
        else if (!cancelled && wasSelected && additive) store.toggleSelected(id);
        return;
      }
      for (const m of movers) {
        delete m.el.dataset.dragging;
        m.el.style.transform = "";
        m.el.style.willChange = "";
        m.el.style.zIndex = "";
      }
      setUi(ui, { dragging: false, hoverZone: null, guides: { x: null, y: null } });
      if (cancelled) return;

      const ids = movers.map((m) => m.id);
      if (hover) {
        store.dispatch(dropCommand(ids, hover));
        return;
      }
      if (Math.abs(delta.dx) < 0.0015 && Math.abs(delta.dy) < 0.0015) return;
      const game = store.get().game;
      if (!game) return;

      const commands: GameCommand[] = [];
      const groupSet = new Set(groupAnchors.keys());
      for (const [gid, anchor] of groupAnchors) {
        const moved = clampPos({ x: anchor.x + delta.dx, y: anchor.y + delta.dy });
        commands.push({ type: "SET_GROUP", ids: [], groupId: gid, group: { anchor: moved } });
      }
      const placements = movers
        .filter((m) => {
          const gid = game.cards[m.id]?.groupId;
          return !(gid && groupSet.has(gid));
        })
        .map((m) => ({ id: m.id, x: m.orig.x + delta.dx, y: m.orig.y + delta.dy }));
      const moving = new Set(ids);
      const order = [...game.zones.battlefield.filter((cid) => !moving.has(cid)), ...game.zones.battlefield.filter((cid) => moving.has(cid))];
      if (placements.length > 0 || order.some((cid, i) => cid !== game.zones.battlefield[i])) commands.push({ type: "SET_LAYOUT", placements, order });
      if (commands.length === 0) return;
      store.dispatch(commands.length === 1 ? commands[0] : { type: "BATCH", commands }, { label: ids.length === 1 ? undefined : `Moved ${ids.length} cards on the table.` });
    }
    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  /** Drag on empty table: box-select. A plain click on empty table clears. */
  function onBoardPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const boardEl = host.board();
    const box = host.marquee();
    if (!boardEl || !box) return;
    const rect = boardEl.getBoundingClientRect();
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const base = additive ? [...store.get().selection] : [];
    let moved = false;

    function frame(ev: PointerEvent) {
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const left = Math.min(start.x, x);
      const top = Math.min(start.y, y);
      return { left, top, width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
    }
    function onMove(ev: PointerEvent) {
      const f = frame(ev);
      if (!moved && Math.hypot(f.width, f.height) < DRAG_THRESHOLD_PX) return;
      moved = true;
      box!.hidden = false;
      box!.style.left = `${f.left}px`;
      box!.style.top = `${f.top}px`;
      box!.style.width = `${f.width}px`;
      box!.style.height = `${f.height}px`;
      const game = store.get().game;
      if (!game) return;
      const hits = cardsInRect(game, { x: f.left / rect.width, y: f.top / rect.height, w: f.width / rect.width, h: f.height / rect.height });
      store.setSelection([...new Set([...base, ...hits])]);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      box!.hidden = true;
      if (!moved && !additive) store.setSelection([]);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return { onCardPointerDown, onBoardPointerDown };
}

/* -------------------------------------------------------------------------- */
/* Dragging a card out of the hand (or a pile) onto the table or a zone.       */
/* -------------------------------------------------------------------------- */

export type HandDragHost = {
  store: PlayStore;
  ui: UiStore;
  board: () => HTMLElement | null;
};

/**
 * Starts a drag of one card from the hand. The card is not moved: a ghost copy
 * follows the pointer (removed on release), so a cancelled drag leaves the hand
 * exactly as it was. Dropped on the table it plays at the drop point (Shift:
 * tapped); on a pile it moves there; back on the hand it re-orders.
 */
export function startHandDrag(
  event: PointerEvent | React.PointerEvent,
  cardId: string,
  source: HTMLElement,
  host: HandDragHost,
  onClick: () => void,
  /** Where the card is being dragged FROM. Dropping back on the hand reorders
   *  it when this is "hand", and moves it into the hand otherwise. */
  fromZone: ZoneId = "hand",
) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const { store, ui } = host;
  const start = { x: event.clientX, y: event.clientY };
  let ghost: HTMLElement | null = null;
  let dragging = false;
  let last = { x: start.x, y: start.y };
  let raf = 0;
  // Read at DROP time, so holding Shift at the last moment plays it tapped.
  let shiftHeld = event.shiftKey;

  const longPress = window.setTimeout(() => {
    if (!dragging) setUi(ui, { inspect: { cardId, big: true } });
  }, LONG_PRESS_MS);

  function paint() {
    raf = 0;
    if (!ghost) return;
    ghost.style.transform = `translate3d(${last.x - start.x}px, ${last.y - start.y}px, 0)`;
    const target = dropTargetAt(last.x, last.y);
    setUi(ui, { hoverZone: target });
  }
  function onMove(ev: PointerEvent) {
    last = { x: ev.clientX, y: ev.clientY };
    shiftHeld = ev.shiftKey;
    if (!dragging) {
      if (Math.hypot(last.x - start.x, last.y - start.y) < DRAG_THRESHOLD_PX) return;
      window.clearTimeout(longPress);
      setUi(ui, { inspect: null, dragging: true });
      dragging = true;
      const box = source.getBoundingClientRect();
      ghost = source.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;pointer-events:none;z-index:2000;opacity:.92;margin:0;will-change:transform;filter:drop-shadow(0 8px 14px rgba(0,0,0,.45))`;
      ghost.setAttribute("aria-hidden", "true");
      document.body.appendChild(ghost);
      source.style.opacity = "0.35";
    }
    if (!raf) raf = requestAnimationFrame(paint);
  }
  function finish(cancelled: boolean) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.clearTimeout(longPress);
    if (raf) cancelAnimationFrame(raf);
    const inspecting = ui.get().inspect;
    if (inspecting?.big) setUi(ui, { inspect: null });
    if (!dragging) {
      if (!cancelled) onClick();
      return;
    }
    ghost?.remove();
    source.style.opacity = "";
    setUi(ui, { dragging: false, hoverZone: null });
    if (cancelled) return;

    const target = dropTargetAt(last.x, last.y);
    if (target === "battlefield") {
      const boardEl = host.board();
      if (!boardEl) return;
      const rect = boardEl.getBoundingClientRect();
      const pos = clampPos({ x: (last.x - rect.left) / rect.width - CARD_W / 2, y: (last.y - rect.top) / rect.height - CARD_H / 2 });
      store.dispatch({ type: "MOVE_MANY", ids: [cardId], to: "battlefield", at: "bottom", pos, tapped: shiftHeld });
    } else if (target === "hand" && fromZone !== "hand") {
      store.dispatch(dropCommand([cardId], "hand"));
    } else if (target === "hand") {
      const game = store.get().game;
      if (!game) return;
      const others = game.zones.hand.filter((id) => id !== cardId);
      const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-hand-card]")).filter((el) => el.dataset.handCard !== cardId);
      let index = others.length;
      for (let i = 0; i < cards.length; i++) {
        const b = cards[i].getBoundingClientRect();
        if (last.x < b.left + b.width / 2) {
          index = i;
          break;
        }
      }
      const order = [...others.slice(0, index), cardId, ...others.slice(index)];
      store.dispatch({ type: "REORDER_ZONE", zone: "hand", order }, { label: "Reordered the hand." });
    } else if (target) {
      store.dispatch(dropCommand([cardId], target));
    }
  }
  const onUp = () => finish(false);
  const onCancel = () => finish(true);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
