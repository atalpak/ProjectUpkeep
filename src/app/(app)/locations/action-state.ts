/**
 * Form state shared between the location server actions and the client
 * components that drive them.
 *
 * Kept out of actions.ts for the same reason as the collection equivalent: a
 * "use server" module may only export async functions, so the initial value
 * cannot live alongside them.
 */
export type LocationActionState = { error: string | null; notice: string | null };

export const EMPTY_LOCATION_STATE: LocationActionState = {
  error: null,
  notice: null,
};
