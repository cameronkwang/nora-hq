"use client";

import Link from "next/link";
import { buttonClass } from "./ui";

type Opt = { id: string; label: string };

/** GET form; selects submit on change (falls back to the Filter button without JS). */
export function DraftFilters({ tab, client, kind, clients, kinds }: { tab: string; client: string; kind: string; clients: Opt[]; kinds: Opt[] }) {
  return (
    <form method="get" action="/review" className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end">
      {tab && <input type="hidden" name="tab" value={tab} />}
      <div className="sm:w-64">
        <label htmlFor="rf-client" className="label">Business</label>
        <select key={client} id="rf-client" name="client" defaultValue={client} className="input" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">All businesses</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="sm:w-52">
        <label htmlFor="rf-kind" className="label">Type</label>
        <select key={kind} id="rf-kind" name="kind" defaultValue={kind} className="input" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          <option value="">All types</option>
          {kinds.map((k) => (
            <option key={k.id} value={k.id}>{k.label}</option>
          ))}
        </select>
      </div>
      <noscript>
        <button type="submit" className={buttonClass("secondary")}>Filter</button>
      </noscript>
      {(client || kind) && (
        <Link href={tab ? `/review?tab=${tab}` : "/review"} className={buttonClass("ghost")}>
          Clear
        </Link>
      )}
    </form>
  );
}
