"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setReelPostedAction } from "@/app/(app)/calendar/schedule-actions";
import { Button } from "./ui";

/** One big button on a job's page: tick the reel as posted (or undo). Same action as the 📸 box on the schedule. */
export function ReelPostedButton({ id, posted }: { id: string; posted: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <div className="grid gap-1">
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
        {pending ? "Saving…" : posted ? "Undo: reel not posted yet" : "📸 Reel posted"}
      </Button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
