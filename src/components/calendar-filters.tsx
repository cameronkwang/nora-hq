"use client";

import Link from "next/link";
import { buttonClass } from "./ui";

type Opt = { id: string; label: string };

/** GET form for /calendar; selects submit on change (Filter button without JS). */
export function CalendarFilters({ month, client, platform, clients }: { month: string; client: string; platform: string; clients: Opt[] }) {
  return (
    <form method="get" action="/calendar" className="flex flex-col gap-2 sm:flex-row sm:items-end">
      {month && <input type="hidden" name="month" value={month} />}
      <div className="sm:w-64">
        <label htmlFor="cf-client" className="label">Business</label>
        <select key={client} id="cf-client" name="client" defaultValue={client} className="input" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">All businesses</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="sm:w-40">
        <label htmlFor="cf-platform" className="label">Platform</label>
        <select key={platform} id="cf-platform" name="platform" defaultValue={platform} className="input" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">Both</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
        </select>
      </div>
      <noscript>
        <button type="submit" className={buttonClass("secondary")}>Filter</button>
      </noscript>
      {(client || platform) && (
        <Link href={month ? `/calendar?month=${month}` : "/calendar"} className={buttonClass("ghost")}>
          Clear
        </Link>
      )}
    </form>
  );
}
