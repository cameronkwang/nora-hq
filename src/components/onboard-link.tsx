import Link from "next/link";
import type React from "react";
import { buttonClass, cx } from "./ui";

export const NEW_CLIENT_HREF = "/clients/new";

/**
 * "+ New client" — the quick way in to onboarding, wherever businesses are listed.
 *  - variant "button" (default): small primary button for page headers (/clients, Home business grid).
 *  - variant "plus": a compact "+" for the desktop sidebar's Businesses heading (.side-add: 44px on touch).
 *  - variant "row": a full-width row for the phone More sheet (.more-row; pass `onClick` to close the sheet).
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
      <Link href={href} onClick={onClick} aria-label="New client" title="New client" className={cx("side-add", className)}>
        <PlusIcon className="size-3.5" />
      </Link>
    );
  }
  if (variant === "row") {
    return (
      <Link href={href} onClick={onClick} className={cx("more-row", className)}>
        <PlusIcon className="size-4" />
        <span className="t font-medium">New client</span>
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
