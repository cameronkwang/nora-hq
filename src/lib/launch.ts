import { formatDate, today } from "./dates";
import type { Client } from "./schema";

/**
 * Pre-launch ("not open yet") helpers. Pure and dependency-free, so the business page, Settings, Home and
 * Claude's briefing all read the same rule.
 *
 * A business with clients.prelaunch on works a short launch checklist (tasks tagged LAUNCH_TAG) instead of the
 * monthly plan: plan tasks aren't created until opening day (clients.openingDate). From opening day on the normal
 * plan applies again, even if nobody switched Pre-launch off yet.
 */

/** tasks.tag for the launch checklist (like "onboarding" for Getting started). */
export const LAUNCH_TAG = "launch";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written "YYYY-MM-DD". */
export function isDay(s: unknown): s is string {
  if (typeof s !== "string" || !DAY.test(s)) return false;
  const t = Date.parse(`${s}T12:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Whole days from one "YYYY-MM-DD" to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export type LaunchInfo = {
  /** The Pre-launch switch is on. */
  prelaunch: boolean;
  /** Opening day, when Pre-launch is on and a date is saved. */
  openingDate: string | null;
  /** Whole days until opening day (0 = today, negative = it has passed). Null without a date. */
  daysToOpening: number | null;
  /** Not open yet (pre-launch with no date, or opening day still ahead): the monthly plan waits. */
  planOnHold: boolean;
  /** Pre-launch is still on but opening day is here or has passed: the monthly plan applies; someone should switch Pre-launch off. */
  opened: boolean;
};

export function launchInfo(c: Pick<Client, "prelaunch" | "openingDate">, day = today()): LaunchInfo {
  if (!c.prelaunch) return { prelaunch: false, openingDate: null, daysToOpening: null, planOnHold: false, opened: false };
  const openingDate = isDay(c.openingDate) ? c.openingDate : null;
  const daysToOpening = openingDate ? daysBetween(day, openingDate) : null;
  const opened = daysToOpening != null && daysToOpening <= 0;
  return { prelaunch: true, openingDate, daysToOpening, planOnHold: !opened, opened };
}

/** "Opens Dec 12 · in 28 days", "Opens tomorrow (Dec 12)", "Opening day is today", "Opening day was Dec 12", "No opening date yet". */
export function openingLine(info: LaunchInfo): string {
  if (!info.prelaunch) return "";
  if (!info.openingDate || info.daysToOpening == null) return "No opening date yet";
  const when = formatDate(info.openingDate);
  const d = info.daysToOpening;
  if (d < 0) return `Opening day was ${when}`;
  if (d === 0) return "Opening day is today";
  if (d === 1) return `Opens tomorrow (${when})`;
  return `Opens ${when} · in ${d} days`;
}

/**
 * For Claude's tools (get_briefing, list_clients, get_client_month): a `prelaunch` field on a business that is marked
 * pre-launch, nothing on one that is open. notOpenYet = the doors aren't open and the monthly plan is waiting.
 */
export function launchField(c: Pick<Client, "prelaunch" | "openingDate">, day = today()) {
  const info = launchInfo(c, day);
  if (!info.prelaunch) return {};
  return { prelaunch: { notOpenYet: info.planOnHold, openingDate: info.openingDate, daysToOpening: info.daysToOpening, summary: openingLine(info) } };
}

/** Why the monthly plan isn't being turned into tasks yet, in plain words. Empty when it isn't on hold. */
export function planHoldLine(name: string, info: LaunchInfo): string {
  if (!info.planOnHold) return "";
  return info.openingDate
    ? `${name} isn't open yet (opens ${formatDate(info.openingDate)}): the monthly plan starts on opening day. Until then, work the launch checklist.`
    : `${name} isn't open yet and has no opening date: the monthly plan starts on opening day. Until then, work the launch checklist.`;
}
