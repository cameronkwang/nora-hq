"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setReelPostedAction } from "@/app/(app)/calendar/schedule-actions";
import { Button, Status } from "./ui";

/**
 * One big button on a job's page: tick the reel as posted (or undo). Same action as the 📸 box on the schedule.
 * While the reel is still to post it is the page's one focal action (ink inside the app); once posted, Undo is quiet.
 * Full width on a phone, so it is easy to hit with a thumb.
 */
export function ReelPostedButton({ id, posted }: { id: string; posted: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <div className="grid justify-items-stretch gap-2 sm:justify-items-start">
      <Button
        variant={posted ? "secondary" : "primary"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            const res = await setReelPostedAction(id, !posted);
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        {pending ? (
          "Saving…"
        ) : posted ? (
          "Undo: reel not posted yet"
        ) : (
          <>
            <span className="emoji" aria-hidden>📸</span> Reel posted
          </>
        )}
      </Button>
      {error && (
        <p role="alert">
          <Status tone="danger" small className="whitespace-normal">
            {error}
          </Status>
        </p>
      )}
    </div>
  );
}
