import { createContext, useContext } from 'react';
import type { Printing } from '@upkeep/scan-core';

export type CardDetailsTarget = {
  name: string;
  printingId?: string | null;
  /** Shown at the top of the sheet. */
  note?: string;
  /**
   * Set by quick scan when the printing is worth checking against the card's
   * picture. The sheet opens at once on `printingId`; it then compares `photoUri`
   * with `candidates` in the background and, only if the result is confident,
   * covers every printing and the person has not chosen one, switches to the
   * winner with a small dismissable line. Never blocks anything.
   */
  scan?: { photoUri: string; candidates: Printing[] };
};

/** Opens the card details sheet from anywhere in the signed-in app (the sheet
 * itself is rendered once, in RootShell). Used by the quick scan, which
 * resolves a card with no screen of its own to hang the sheet on. */
export const CardDetailsContext = createContext<{ open(target: CardDetailsTarget): void }>({ open() {} });
export const useOpenCardDetails = () => useContext(CardDetailsContext).open;
