/**
 * Form state shared between the collection server actions and the client
 * components that drive them.
 *
 * Deliberately *not* in actions.ts: a "use server" module may only export async
 * functions, so a plain object or a const there is a runtime error the moment
 * the route is loaded. Types alone would be fine — they are erased — but the
 * initial value has to live somewhere the directive does not apply.
 */
export type ActionState = {
  error: string | null;
  notice: string | null;
  /**
   * Changes on every successful action. The add form watches this to know when
   * to reset itself — comparing the notice text alone would miss the case where
   * you add the same card twice and get a byte-identical message.
   *
   * Random rather than a counter: server actions can run on a fresh instance
   * each time, so a module-level counter would restart at 1 and collide.
   */
  nonce?: string;
};

export const EMPTY_STATE: ActionState = { error: null, notice: null };
