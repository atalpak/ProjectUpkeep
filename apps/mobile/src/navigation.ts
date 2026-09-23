// Shared route param types and the page registry for the signed-in navigator
// — kept in their own module so App.tsx, the tab bar, the menu, Settings and
// every screen reference the same shape rather than each re-declaring it.
import type { Ionicons } from '@expo/vector-icons';
import type { NavigationState, NavigatorScreenParams, PartialState } from '@react-navigation/native';

export type DecksStackParamList = {
  DeckList: undefined;
  DeckDetail: { deckId: string };
};

export type LocationsStackParamList = {
  LocationList: undefined;
  /** `locationId: null` is the "Unsorted" pile. */
  LocationDetail: { locationId: string | null; title: string };
};

export type FriendsStackParamList = {
  FriendList: undefined;
  FriendProfile: { friendId: string; username: string; friendshipId: string };
};

export type TradesStackParamList = {
  TradeList: undefined;
  TradeDetail: { tradeId: string };
  /** `counterOf` set = replacing an offer you received; the builder opens pre-filled. */
  TradeBuilder: { friendId: string; username: string; counterOf?: string };
};

/**
 * Every top-level page is a screen of one tab navigator. The tab BAR shows
 * only five of them (Scan fixed in the middle, four the user picks); the rest
 * are reachable from the menu. A page not in the bar is still a real route,
 * so `navigate(name)` works the same either way.
 */
export type TabParamList = {
  Scan: undefined;
  Dashboard: undefined;
  Collection: undefined;
  Locations: undefined;
  Decks: undefined;
  Search: undefined;
  Wishlist: undefined;
  Friends: undefined;
  Trades: NavigatorScreenParams<TradesStackParamList> | undefined;
  Notifications: undefined;
  Import: undefined;
  Settings: undefined;
};

export type PageId = keyof TabParamList;
type IconName = keyof typeof Ionicons.glyphMap;

export type PageInfo = {
  id: PageId;
  title: string;
  /** Short label for the tab bar, where the full title would not fit. */
  short?: string;
  outline: IconName;
  filled: IconName;
};

export const PAGES: Record<PageId, PageInfo> = {
  Scan: { id: 'Scan', title: 'Scan', outline: 'scan-outline', filled: 'scan' },
  Dashboard: { id: 'Dashboard', title: 'Dashboard', outline: 'stats-chart-outline', filled: 'stats-chart' },
  Collection: { id: 'Collection', title: 'Collection', outline: 'albums-outline', filled: 'albums' },
  Locations: { id: 'Locations', title: 'Locations', outline: 'file-tray-stacked-outline', filled: 'file-tray-stacked' },
  Decks: { id: 'Decks', title: 'Decks', outline: 'layers-outline', filled: 'layers' },
  Search: { id: 'Search', title: 'Search', outline: 'search-outline', filled: 'search' },
  Wishlist: { id: 'Wishlist', title: 'Wish List', outline: 'heart-outline', filled: 'heart' },
  Friends: { id: 'Friends', title: 'Friends', outline: 'people-outline', filled: 'people' },
  Trades: { id: 'Trades', title: 'Trades', outline: 'swap-horizontal-outline', filled: 'swap-horizontal' },
  Notifications: { id: 'Notifications', title: 'Notifications', short: 'Alerts', outline: 'notifications-outline', filled: 'notifications' },
  Import: { id: 'Import', title: 'Import', outline: 'download-outline', filled: 'download' },
  Settings: { id: 'Settings', title: 'Settings', outline: 'settings-outline', filled: 'settings' },
};

/** Menu order. Scan is first: it is the centre of the bar but still a page. */
export const MENU_ORDER: PageId[] = [
  'Scan', 'Dashboard', 'Collection', 'Locations', 'Decks', 'Search', 'Wishlist',
  'Friends', 'Trades', 'Notifications', 'Import', 'Settings',
];

/** Pages a user may pin to the bar: everything but Scan (fixed) and Settings
 * (always reachable from the menu, and losing it from every route would be a
 * trap). */
export const PINNABLE: PageId[] = MENU_ORDER.filter(id => id !== 'Scan' && id !== 'Settings');

/** Left-to-right: two slots, Scan, two slots. */
export type NavSlots = [PageId, PageId, PageId, PageId];
export const DEFAULT_SLOTS: NavSlots = ['Collection', 'Decks', 'Locations', 'Wishlist'];

/** Pages that already have a real screen; the rest render a "coming soon". */
export const BUILT: ReadonlySet<PageId> = new Set<PageId>(['Scan', 'Dashboard', 'Collection', 'Decks', 'Search', 'Wishlist', 'Locations', 'Friends', 'Trades', 'Notifications', 'Import', 'Settings']);

export type HeaderBackInfo = { canGoBack: boolean; label: string };

/**
 * Whether the unified AppHeader (App.tsx) should show a back chevron: true
 * only when the currently focused tab's OWN nested stack (Decks, Locations,
 * Friends or Trades -- the only four with a native-stack navigator, see
 * App.tsx) has pushed past its root screen. Native headers are off on every
 * one of those stacks (they'd double up with this header otherwise), so this
 * is the only place that knows a detail screen is showing.
 *
 * Only looks one level deep because none of the four nested stacks nest a
 * third level -- if one ever does, this needs to recurse into `nested.state`
 * instead of stopping at `nested.index`.
 */
export function getHeaderBackInfo(state: NavigationState | PartialState<NavigationState> | undefined): HeaderBackInfo {
  if (!state) return { canGoBack: false, label: '' };
  const index = state.index ?? state.routes.length - 1;
  const tabRoute = state.routes[index];
  const tabId = tabRoute?.name as PageId | undefined;
  const nested = tabRoute?.state;
  if (tabId && nested && typeof nested.index === 'number' && nested.index > 0) {
    return { canGoBack: true, label: PAGES[tabId].short ?? PAGES[tabId].title };
  }
  return { canGoBack: false, label: '' };
}
