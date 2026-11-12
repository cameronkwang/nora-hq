import type { ReactNode } from "react";

/**
 * A small, safe Markdown renderer for client reports (Claude writes them). Builds React elements only — never
 * raw HTML — so nothing in a report can inject markup or script. Supports: # / ## / ### headings, paragraphs,
 * "-"/"*"/"•" bullets, "1." lists, > quotes, --- rules, **bold**, *italic* / _italic_, `code` and
 * [links](https://…) (http, https and mailto only). Also exports markdownToPlainText for email + copy.
 * No hooks and no server imports: usable from server and client components alike.
 */

type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "hr" };

function parse(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) { flush(); out.push({ t: "h", level: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2].replace(/\s*#+$/, "") }); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); out.push({ t: "hr" }); continue; }
    const bullet = /^[-*•+]\s+(.*)$/.exec(trimmed);
    const num = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || num) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const last = out[out.length - 1];
      const text = (bullet ?? num)![1];
      if (last && last.t === kind) last.items.push(text);
      else out.push({ t: kind, items: [text] });
      continue;
    }
    // Indented continuation of a list item.
    const prev = out[out.length - 1];
    if (!para.length && prev && (prev.t === "ul" || prev.t === "ol") && /^\s{2,}/.test(line)) {
      prev.items[prev.items.length - 1] += ` ${trimmed}`;
      continue;
    }
    const q = /^>\s?(.*)$/.exec(trimmed);
    if (q) {
      flush();
      const last = out[out.length - 1];
      if (last && last.t === "quote") last.text += ` ${q[1]}`;
      else out.push({ t: "quote", text: q[1] });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return out;
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** Inline: links, bold, italic, code. */
function inline(text: string, key = "i"): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*\s][^*]*)\*)|(\b_([^_]+)_\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) {
      const href = m[3];
      nodes.push(
        SAFE_URL.test(href) ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-2 hover:underline">{inline(m[2], k)}</a>
        ) : (
          <span key={k}>{m[2]}</span>
        ),
      );
    } else if (m[4]) nodes.push(<strong key={k} className="font-semibold">{inline(m[5], k)}</strong>);
    else if (m[6]) nodes.push(<code key={k} className="rounded bg-surface-2 px-1 py-0.5 text-[0.9em]">{m[7]}</code>);
    else if (m[8]) nodes.push(<em key={k}>{inline(m[9], k)}</em>);
    else if (m[10]) nodes.push(<em key={k}>{inline(m[11], k)}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function ReportMarkdown({ body, className }: { body: string; className?: string }) {
  const blocks = parse(body);
  return (
    <div className={["min-w-0 break-words text-[15px] leading-relaxed md:text-sm", className].filter(Boolean).join(" ")}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case "h":
            return b.level === 1 ? (
              <h2 key={k} className="mb-2 mt-5 text-xl font-semibold tracking-tight first:mt-0">{inline(b.text, k)}</h2>
            ) : b.level === 2 ? (
              <h3 key={k} className="mb-1.5 mt-5 text-base font-semibold first:mt-0">{inline(b.text, k)}</h3>
            ) : (
              <h4 key={k} className="mb-1 mt-4 text-sm font-semibold uppercase tracking-wide text-muted first:mt-0">{inline(b.text, k)}</h4>
            );
          case "p":
            return <p key={k} className="my-2">{inline(b.text, k)}</p>;
          case "ul":
            return <ul key={k} className="my-2 list-disc space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
          case "ol":
            return <ol key={k} className="my-2 list-decimal space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>;
          case "quote":
            return <blockquote key={k} className="my-3 border-l-2 border-accent pl-3 text-muted">{inline(b.text, k)}</blockquote>;
          case "hr":
            return <hr key={k} className="my-4 border-border" />;
        }
      })}
    </div>
  );
}

function plainInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => (SAFE_URL.test(u) ? (t === u ? u : `${t} (${u.replace(/^mailto:/i, "")})`) : t))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*\s][^*]*)\*/g, "$1")
    .replace(/\b_([^_]+)_\b/g, "$1");
}

/** Plain-text rendering for email and "Copy": headings on their own line, "•" bullets, links as "text (url)". */
export function markdownToPlainText(md: string): string {
  const out: string[] = [];
  for (const b of parse(md)) {
    switch (b.t) {
      case "h":
        out.push(b.level === 1 ? plainInline(b.text).toUpperCase() : plainInline(b.text));
        break;
      case "p":
        out.push(plainInline(b.text));
        break;
      case "ul":
        out.push(b.items.map((x) => `• ${plainInline(x)}`).join("\n"));
        break;
      case "ol":
        out.push(b.items.map((x, i) => `${i + 1}. ${plainInline(x)}`).join("\n"));
        break;
      case "quote":
        out.push(`“${plainInline(b.text)}”`);
        break;
      case "hr":
        out.push("—");
        break;
    }
  }
  return out.join("\n\n").trim();
}
