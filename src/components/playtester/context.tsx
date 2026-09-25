"use client";

import { createContext, useContext } from "react";

import type { ExternalStore } from "@/components/playtester/store";
import type { UiState, UiStore } from "@/components/playtester/ui-store";
import { useExternal } from "@/components/playtester/hooks/useStore";
import type { CatalogInfo } from "@/lib/playtest/catalog";
import type { Settings } from "@/lib/playtest/settings";
import type { ActionResult, SavesSummary, SessionSummary, ShareSummary } from "@/lib/playtest/session";

/**
 * Everything the panels need that is neither game state (the play store) nor
 * transient UI state (the ui store): who and which deck this is, the catalogue
 * of oracle text for the inspector, the settings store, the server actions
 * (passed IN by `page.tsx` as props; nothing here imports from `@/app`), and
 * `perform`, the single interpreter that turns an action id ("draw",
 * "untap-all", ...) into store dispatches and dialog opens. Keyboard
 * shortcuts, the command palette and the menus all call `perform`, which is why
 * an action reachable from one is reachable from all of them.
 *
 * The env object is created once and never replaced, so putting it in context
 * does not re-render consumers; values that change live in the stores.
 */

/** The bound server actions. `null` when saving is unavailable (no account
 *  session, or the migrations are not applied), and the UI then says so. */
export type PlayActionsApi = {
  saveSession(input: { title: string; snapshot: unknown }): Promise<ActionResult<{ session: SessionSummary }>>;
  overwriteSession(input: { id: string; expectedUpdatedAt: string; snapshot: unknown }): Promise<ActionResult<{ session: SessionSummary }>>;
  renameSession(input: { id: string; title: string }): Promise<ActionResult<{ session: SessionSummary }>>;
  duplicateSession(input: { id: string }): Promise<ActionResult<{ session: SessionSummary }>>;
  deleteSession(input: { id: string }): Promise<ActionResult>;
  createShare(input: { snapshot: unknown; showHand: boolean; title?: string }): Promise<ActionResult<{ share: ShareSummary }>>;
  refreshShare(input: { id: string; snapshot: unknown; showHand: boolean; extend?: boolean }): Promise<ActionResult<{ share: ShareSummary }>>;
  deleteShare(input: { id: string }): Promise<ActionResult>;
};

export type Perform = (id: string, arg?: number | string | null, mode?: "set" | "delta" | null) => void;

export type PlayEnv = {
  deckId: string;
  deckName: string;
  userId: string;
  /** Hex digest of the deck as loaded now, from the server. */
  fingerprint: string;
  ui: UiStore;
  settings: ExternalStore<Settings>;
  catalog: ReadonlyMap<string, CatalogInfo>;
  actions: PlayActionsApi | null;
  saves: SavesSummary;
  perform: Perform;
  /** Bumped by the recovery hook so the indicator can re-read its status. */
  recovery: ExternalStore<RecoveryStatus>;
  /** Origin for share links, read on the client. */
  origin: () => string;
};

export type RecoveryStatus = { state: "idle" | "saved" | "failed" | "off"; savedAt: number | null };

const PlayEnvContext = createContext<PlayEnv | null>(null);
export const PlayEnvProvider = PlayEnvContext.Provider;

export function usePlayEnv(): PlayEnv {
  const env = useContext(PlayEnvContext);
  if (!env) throw new Error("usePlayEnv must be used inside <PlayEnvProvider>.");
  return env;
}

export function useSettings(): Settings {
  const env = usePlayEnv();
  return useExternal(env.settings, (s) => s);
}

export function useUi<T>(selector: (state: UiState) => T): T {
  const env = usePlayEnv();
  return useExternal(env.ui, selector);
}
