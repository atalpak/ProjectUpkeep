"use server";

import { revalidatePath } from "next/cache";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * Notification actions.
 *
 * Notifications are created by a database trigger, never here. All this layer
 * does is let you mark them read or clear them — both bounded by the row-level
 * policies, so there is nothing to re-check.
 */

function refresh() {
  revalidatePath("/notifications");
  // The nav badge lives in the app layout; nudge it too.
  revalidatePath("/", "layout");
}

/** Marks every unread notification read. Called when the inbox is opened. */
export async function markAllNotificationsRead(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  refresh();
}

/** Clears the inbox entirely. */
export async function clearNotifications(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;

  const supabase = await createClient();
  // A delete needs a filter; `created_at` is always set, so this matches every
  // row the delete policy already limits to the caller's own.
  await supabase.from("notifications").delete().not("created_at", "is", null);

  refresh();
}
