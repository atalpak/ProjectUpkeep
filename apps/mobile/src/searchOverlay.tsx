import { createContext, useContext } from 'react';

/** Opens the slide-in search bar. The bar itself lives in RootShell; the tab
 * bar's fan-out button, the menu and a pinned Search tab all reach it here. */
export const SearchOverlayContext = createContext<{ open(): void }>({ open() {} });
export const useSearchOverlay = () => useContext(SearchOverlayContext);
