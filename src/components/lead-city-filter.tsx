"use client";

import { useRouter } from "next/navigation";

/** City filter for /leads: a native select (best on phones) that navigates on change. */
export function LeadCityFilter({ cities, current, hrefs }: { cities: Array<{ name: string; count: number }>; current: string; hrefs: Record<string, string> }) {
  const router = useRouter();
  return (
    <div className="w-full sm:w-48">
      <label className="sr-only" htmlFor="lead-city">City</label>
      <select id="lead-city" className="input" value={current} onChange={(e) => router.push(hrefs[e.target.value] ?? hrefs[""])}>
        <option value="">Any city</option>
        {cities.map((c) => (
          <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
        ))}
      </select>
    </div>
  );
}
