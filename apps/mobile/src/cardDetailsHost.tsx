import { createContext, useContext } from 'react';

export type CardDetailsTarget = {
  name: string;
  printingId?: string | null;
  /** Shown at the top of the sheet. */
  note?: string;
  /**
   * Set when a scan could not settle which printing this is: the sheet opens
   * with a "Which printing is this?" picker at the top instead of assuming one.
   * `optionIds` are the candidates, best guess first; `bestId` is highlighted but
   * still needs one tap; `photoUri` is the scanned card, shown beside them.
   * `pinned` means the scan settled on `bestId` and no tap is needed -- but only
   * if that printing really is in the live list; otherwise the picker opens.
   */
  verify?: {
    optionIds: string[]; bestId: string | null; photoUri: string | null; pinned?: boolean;
    /** Every printing id the scan-time (offline) catalog had for this card, so a stale catalog is caught against the live list. */
    knownIds: string[];
  };
};

/** Opens the card details sheet from anywhere in the signed-in app (the sheet
 * itself is rendered once, in RootShell). Used by the quick scan, which
 * resolves a card with no screen of its own to hang the sheet on. */
export const CardDetailsContext = createContext<{ open(target: CardDetailsTarget): void }>({ open() {} });
export const useOpenCardDetails = () => useContext(CardDetailsContext).open;
