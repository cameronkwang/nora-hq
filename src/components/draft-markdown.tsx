import type { ReactNode } from "react";

/**
 * Tiny, safe markdown → React renderer for report drafts. Everything becomes React text nodes — raw HTML in the
 * source is shown as text, never parsed. Supports: # headings, paragraphs (single newlines kept as line breaks),
 * - / * / 1. lists, > quotes, --- rules, simple | pipe | tables, **bold**, *italic*, `code`, [links](https://…)
 * and bare https:// URLs. Links only render for http(s): and mailto: — anything else stays plain text.
 * Pure (no hooks), so it works in server and client components.
 */

export function safeHref(raw: string): string | null {
  const s = raw.trim();
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") return u.toString();
  } catch {
    /* not an absolute URL */
  }
  return null;
}

const INLINE_RE =
  /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*(?![\s*])([^*\n]+?)\*|\b_(?!\s)([^_\n]+?)_\b|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(text: string, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${k++}`;
    const [whole, b1, b2, code, linkText, linkHref, i1, i2, bare] = m;
    if (b1 !== undefined || b2 !== undefined) out.push(<strong key={key}>{inline(b1 ?? b2 ?? "", key)}</strong>);
    else if (code !== undefined) out.push(<code key={key} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em]">{code}</code>);
    else if (linkText !== undefined) {
      const href = safeHref(linkHref ?? "");
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2">
            {inline(linkText, key)}
          </a>
        ) : (
          <span key={key}>{whole}</span>
        ),
      );
    } else if (i1 !== undefined || i2 !== undefined) out.push(<em key={key}>{inline(i1 ?? i2 ?? "", key)}</em>);
    else if (bare !== undefined) {
      const href = safeHref(bare);
      out.push(href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline underline-offset-2">{bare}</a> : bare);
    }
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withBreaks(lines: string[], keyBase: string): ReactNode[] {
  return lines.flatMap((l, i) => (i === 0 ? inline(l, `${keyBase}-${i}`) : [<br key={`${keyBase}-br${i}`} />, ...inline(l, `${keyBase}-${i}`)]));
}

const H_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function Markdown({ source, className }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  const isBlockStart = (l: string) => H_RE.test(l) || UL_RE.test(l) || OL_RE.test(l) || HR_RE.test(l) || QUOTE_RE.test(l) || TABLE_RE.test(l);

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${b++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = H_RE.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "text-lg font-semibold" : level === 2 ? "text-base font-semibold" : "text-sm font-semibold";
      blocks.push(level === 1 ? <h3 key={key} className={cls}>{inline(h[2], key)}</h3> : level === 2 ? <h4 key={key} className={cls}>{inline(h[2], key)}</h4> : <h5 key={key} className={cls}>{inline(h[2], key)}</h5>);
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      blocks.push(<hr key={key} className="border-border" />);
      i++;
      continue;
    }
    if (TABLE_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_RE.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr>{head.map((c, j) => <th key={j} className="border-b border-border px-2 py-1.5 text-left font-semibold">{inline(c, `${key}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{head.map((_, j) => <td key={j} className="border-b border-border px-2 py-1.5 align-top">{inline(r[j] ?? "", `${key}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = !UL_RE.test(line);
      const re = ordered ? OL_RE : UL_RE;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) items.push(re.exec(lines[i++])![1]);
      const lis = items.map((t, j) => <li key={j}>{inline(t, `${key}-${j}`)}</li>);
      blocks.push(ordered ? <ol key={key} className="list-decimal space-y-1 pl-5">{lis}</ol> : <ul key={key} className="list-disc space-y-1 pl-5">{lis}</ul>);
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const q: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) q.push(QUOTE_RE.exec(lines[i++])![1]);
      blocks.push(<blockquote key={key} className="border-l-2 border-border pl-3 text-muted">{withBreaks(q, key)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) para.push(lines[i++]);
    blocks.push(<p key={key}>{withBreaks(para, key)}</p>);
  }

  return <div className={["flex flex-col gap-3 break-words text-sm leading-relaxed", className].filter(Boolean).join(" ")}>{blocks}</div>;
}
