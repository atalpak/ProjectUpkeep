"use client";

import { useActionState } from "react";

import { sendFriendRequest } from "@/app/(app)/friends/actions";
import { EMPTY_SOCIAL_STATE } from "@/app/(app)/social-state";
import { Banner, Button } from "@/components/ui";

export function ProfileFriendRequest({ profileId }: { profileId: string }) {
  const [state, action, pending] = useActionState(sendFriendRequest, EMPTY_SOCIAL_STATE);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="addressee_id" value={profileId} />
      <Button type="submit" disabled={pending || Boolean(state.notice)}>
        {state.notice ? "Request sent" : pending ? "Sending…" : "Add friend"}
      </Button>
      <Banner kind="error">{state.error}</Banner>
    </form>
  );
}
