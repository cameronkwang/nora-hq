import type { Creator } from "@/lib/schema";

/** Creator profile inputs shared by "Add creator" and the profile edit form. Server-component safe. */
export function CreatorFields({ creator }: { creator?: Creator }) {
  const c = creator;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="cr-name">Name</label>
        <input id="cr-name" name="name" required className="input" defaultValue={c?.name ?? ""} placeholder="e.g. Jess Eats RVA" autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="cr-ig">Instagram handle</label>
        <input id="cr-ig" name="instagramHandle" className="input" defaultValue={c?.instagramHandle ?? ""} placeholder="@handle or profile link" autoCapitalize="none" autoComplete="off" spellCheck={false} />
      </div>
      <div>
        <label className="label" htmlFor="cr-tt">TikTok handle</label>
        <input id="cr-tt" name="tiktokHandle" className="input" defaultValue={c?.tiktokHandle ?? ""} placeholder="@handle or profile link" autoCapitalize="none" autoComplete="off" spellCheck={false} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="cr-email">Public email</label>
        <input id="cr-email" name="email" type="email" className="input" defaultValue={c?.email ?? ""} placeholder="From their bio or website" autoCapitalize="none" autoComplete="off" />
        <p className="mt-1 text-xs text-muted">Only use emails creators list publicly.</p>
      </div>
      <div>
        <label className="label" htmlFor="cr-city">City</label>
        <input id="cr-city" name="city" className="input" defaultValue={c?.city ?? ""} placeholder="e.g. Richmond, VA" />
      </div>
      <div>
        <label className="label" htmlFor="cr-niche">Niche</label>
        <input id="cr-niche" name="niche" className="input" defaultValue={c?.niche ?? ""} placeholder="e.g. local food, date night, family" />
      </div>
      <div className="grid grid-cols-3 gap-3 sm:col-span-2">
        <div>
          <label className="label" htmlFor="cr-igf">IG followers</label>
          <input id="cr-igf" name="instagramFollowers" inputMode="decimal" className="input" defaultValue={c?.instagramFollowers ?? ""} placeholder="12.5k" />
        </div>
        <div>
          <label className="label" htmlFor="cr-ttf">TikTok followers</label>
          <input id="cr-ttf" name="tiktokFollowers" inputMode="decimal" className="input" defaultValue={c?.tiktokFollowers ?? ""} placeholder="40k" />
        </div>
        <div>
          <label className="label" htmlFor="cr-er">Engagement %</label>
          <input id="cr-er" name="engagementRate" inputMode="decimal" className="input" defaultValue={c?.engagementRate ?? ""} placeholder="3.4" />
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="cr-src">Where you read the numbers (link)</label>
        <input id="cr-src" name="statsSource" inputMode="url" className="input" defaultValue={c?.statsSource ?? ""} placeholder="https://www.tiktok.com/@handle" autoCapitalize="none" autoComplete="off" spellCheck={false} />
        <p className="mt-1 text-xs text-muted">Their public profile. With a link, the numbers count as checked today.</p>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="cr-notes">Notes</label>
        <textarea id="cr-notes" name="notes" className="input" defaultValue={c?.notes ?? ""} placeholder="Content style, past collabs, dietary notes, best time to reach them…" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="cr-source">Source</label>
        <input id="cr-source" name="source" className="input" defaultValue={c?.source ?? ""} placeholder="e.g. manual, Claude research, tagged us" list="cr-source-options" />
        <datalist id="cr-source-options">
          <option value="manual" />
          <option value="claude research" />
          <option value="tagged us" />
          <option value="referral" />
          <option value="vendor" />
        </datalist>
      </div>
    </div>
  );
}
