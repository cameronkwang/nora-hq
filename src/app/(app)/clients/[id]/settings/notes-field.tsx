"use client";

import { useState } from "react";
import { PASSWORD_WARNING, looksLikeSecret } from "@/lib/credential-guard";

/** Settings → Notes textarea that warns as you type when the text looks like it holds a password or login. */
export function NotesField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const matches = looksLikeSecret(value);
  return (
    <div>
      <label className="label" htmlFor="s-notes">Notes</label>
      <textarea
        id="s-notes"
        name="notes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        className="input"
        aria-describedby={matches.length ? "s-notes-warn" : undefined}
        aria-invalid={matches.length ? true : undefined}
        placeholder="Contacts, Facebook Page link, owner preferences, posting rules… (never passwords)"
      />
      {matches.length > 0 && (
        <p id="s-notes-warn" role="alert" className="mt-1.5 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
          {PASSWORD_WARNING}{" "}
          <span className="text-xs">Looks like: {matches.slice(0, 3).map((m) => m.hint).join(", ")}</span>
        </p>
      )}
    </div>
  );
}
