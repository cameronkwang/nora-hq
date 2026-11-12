import { REPLY_CATEGORIES, REPLY_CATEGORY_LABEL } from "./reply-fill";

/** Title / category / body fields shared by the add, edit and keep-suggestion forms on /replies. Server-safe. */
export function ReplyFields({
  idPrefix,
  title = "",
  body = "",
  category = "",
}: {
  idPrefix: string;
  title?: string;
  body?: string;
  category?: string | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
      <div>
        <label className="label" htmlFor={`${idPrefix}-title`}>Title</label>
        <input id={`${idPrefix}-title`} name="title" required maxLength={120} defaultValue={title} className="input" placeholder="e.g. Rates & next steps" autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor={`${idPrefix}-cat`}>Category</label>
        <select id={`${idPrefix}-cat`} name="category" defaultValue={category ?? ""} className="input">
          <option value="">None</option>
          {REPLY_CATEGORIES.map((c) => (
            <option key={c} value={c}>{REPLY_CATEGORY_LABEL[c]}</option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`${idPrefix}-body`}>Text</label>
        <textarea
          id={`${idPrefix}-body`}
          name="body"
          required
          maxLength={4000}
          rows={Math.min(14, Math.max(5, body.split("\n").length + 1))}
          defaultValue={body}
          className="input leading-relaxed"
          placeholder={"Hi {name}! Thanks so much for reaching out about {business}…"}
        />
        <p className="mt-1 text-xs text-muted">
          Placeholders fill in automatically where we know them: <code>{"{name}"}</code> <code>{"{business}"}</code> <code>{"{date}"}</code> <code>{"{link}"}</code>
        </p>
      </div>
    </div>
  );
}
