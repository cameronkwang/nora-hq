import Link from "next/link";
import type React from "react";
import { buttonClass, cx } from "./ui";

export const NEW_CLIENT_HREF = "/clients/new";

/**
 * "+ New client" — the quick way in to onboarding, wherever businesses are listed.
 *  - variant "button" (default): small primary button for page headers (/clients, Home business grid).
 *  - variant "plus": a compact "+" for the desktop sidebar's Businesses heading (44px hit area on touch).
 *  - variant "row": a full-width row for the phone More sheet (pass `onClick` to close the sheet).
 * No hooks, so it works in server and client components alike.
 */
export function NewClientLink({
  variant = "button",
  onClick,
  className,
  leadId,
  size = "sm",
  children = "New client",
}: {
  variant?: "button" | "plus" | "row";
  onClick?: () => void;
  className?: string;
  /** Prefill the flow from a lead (/clients/new?lead=…); it's marked Won on submit. */
  leadId?: string;
  size?: "sm" | "md";
  children?: React.ReactNode;
}) {
  const href = leadId ? `${NEW_CLIENT_HREF}?lead=${encodeURIComponent(leadId)}` : NEW_CLIENT_HREF;
  if (variant === "plus") {
    return (
      <Link
        href={href}
        onClick={onClick}
        aria-label="New client"
        title="New client"
        className={cx("tap-target inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-accent", className)}
      >
        <PlusIcon className="size-4" />
      </Link>
    );
  }
  if (variant === "row") {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={cx("flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium text-accent active:bg-surface-2", className)}
      >
        <PlusIcon className="size-5 shrink-0" />
        <span className="min-w-0 flex-1">New client</span>
      </Link>
    );
  }
  return (
    <Link href={href} onClick={onClick} className={cx(buttonClass("primary", size), className)}>
      {!leadId && <PlusIcon className={size === "sm" ? "size-3.5" : "size-4"} />}
      {children}
    </Link>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
