"use client";

import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { toggleTaskDone } from "@/app/(app)/tasks/actions";

/** How far (share of the row's width) a swipe has to travel to count. */
const THRESHOLD = 0.35;

/**
 * A task row Nora can swipe away (either direction) on a phone to mark it done, as well as tick. Vertical scrolling is
 * left to the browser (touch-action: pan-y); a sideways drag moves the row, and past THRESHOLD it slides out and the
 * task is marked done with the same action as the tick. A short drag snaps back. Taps still open the task.
 */
export function SwipeToDone({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; dir: "x" | "y" | null } | null>(null);
  const moved = useRef(false);
  const [dx, setDx] = useState(0);
  const [gone, setGone] = useState(false);

  function onStart(e: TouchEvent) {
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY, dir: null };
    moved.current = false;
  }
  function onMove(e: TouchEvent) {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const x = t.clientX - s.x;
    const y = t.clientY - s.y;
    if (!s.dir) {
      if (Math.abs(x) > 10 && Math.abs(x) > Math.abs(y)) s.dir = "x";
      else if (Math.abs(y) > 10) s.dir = "y";
    }
    if (s.dir === "x") {
      moved.current = true;
      setDx(x);
    }
  }
  function onEnd() {
    const s = start.current;
    start.current = null;
    if (!s || s.dir !== "x") return;
    const width = box.current?.offsetWidth ?? 320;
    if (Math.abs(dx) > width * THRESHOLD) {
      setDx(dx > 0 ? width : -width);
      setGone(true);
      window.setTimeout(() => form.current?.requestSubmit(), 180);
    } else {
      setDx(0);
    }
  }

  const progress = Math.min(1, Math.abs(dx) / ((box.current?.offsetWidth ?? 320) * THRESHOLD));
  return (
    <div className={gone ? "swipe is-gone" : "swipe"}>
      <span className="swipe-under" aria-hidden style={{ opacity: progress, justifyContent: dx < 0 ? "flex-end" : "flex-start" }}>
        Done
      </span>
      <div
        ref={box}
        className="swipe-row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: start.current ? "none" : undefined }}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={() => {
          start.current = null;
          setDx(0);
        }}
        onClickCapture={(e) => {
          // A swipe that ends over the link isn't a tap.
          if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
          }
        }}
      >
        {children}
      </div>
      <form ref={form} action={toggleTaskDone} hidden>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="done" value="1" />
        <button type="submit" tabIndex={-1} aria-label={`Mark “${title}” done`} />
      </form>
    </div>
  );
}
