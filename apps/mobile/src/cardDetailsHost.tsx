import { createContext, useContext } from 'react';

export type CardDetailsTarget = {
  name: string;
  printingId?: string | null;
  /** Shown at the top of the sheet, e.g. how a scan matched. */
  note?: string;
};

/** Opens the card details sheet from anywhere in the signed-in app (the sheet
 * itself is rendered once, in RootShell). Used by the quick scan, which
 * resolves a card with no screen of its own to hang the sheet on. */
export const CardDetailsContext = createContext<{ open(target: CardDetailsTarget): void }>({ open() {} });
export const useOpenCardDetails = () => useContext(CardDetailsContext).open;
