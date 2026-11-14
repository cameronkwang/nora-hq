"use client";

import { useState } from "react";
import { PASSWORD_WARNING, looksLikeSecret } from "@/lib/credential-guard";

/** The same text once line endings and outer spaces are evened out (saving trims the notes and can change line endings). */
const sameText = (a: string, b: string) => a.replace(/\r\n?/g, "\n").trim() === b.replace(/\r\n?/g, "\n").trim();

/**
 * Settings → Notes textarea that warns as you type when the text looks like it holds a password or login.
 *
 * The box follows the saved notes: when they change while the page is open (clearing the Facebook Page under Public
 * facts takes its "Facebook Page: …" line out of them), an untouched box shows the new text, so the next "Save
 * details" doesn't write the old notes back. Text the person is in the middle of typing is never replaced.
 */
export function NotesField({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const [saved, setSaved] = useState(defaultValue);
  if (saved !== defaultValue) {
    setSaved(defaultValue);
    if (sameText(value, saved)) setValue(defaultValue);
  }
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
        placeholder="Contacts, owner preferences, posting rules… (never passwords)"
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
