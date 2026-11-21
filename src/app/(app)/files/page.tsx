import Link from "next/link";
import { assigneeFor, requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { listFiles } from "@/lib/ops-files";
import { SHARED_FILE_KINDS, type SharedFile, type SharedFileKind } from "@/lib/schema";
import { blobEnabled } from "@/lib/uploads";
import { FileSendForm } from "@/components/file-send-form";
import { ConfirmButton } from "@/components/client-form";
import { Chevron } from "@/components/nora-home";
import { Card, Count, EmptyState, LinkButton, PageHeader, Status } from "@/components/ui";
import { removeFileAction } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<SharedFileKind, string> = { contract: "Contract", invoice: "Invoice", other: "Other" };
const KIND_TABS: Record<SharedFileKind, string> = { contract: "Contracts", invoice: "Invoices", other: "Other" };

/**
 * /files. For Nora: the folder of everything Cameron has sent her (contracts, invoices, anything else), new ones
 * first, and the way in to making her own contract. For Cameron: the form that sends her a file, and what he has
 * sent with whether she has opened it.
 */
export default async function FilesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const nora = assigneeFor(user) === "nora";
  const sp = await searchParams;
  const kindIn = typeof sp.kind === "string" ? sp.kind : "";
  const kind = (SHARED_FILE_KINDS as readonly string[]).includes(kindIn) ? (kindIn as SharedFileKind) : undefined;
  const all = await listFiles();
  const shown = kind ? all.filter((f) => f.kind === kind) : all;
  const fresh = shown.filter((f) => !f.openedAt);
  const earlier = shown.filter((f) => f.openedAt);

  const chips = all.length > 0 && (
    <nav aria-label="Kind of file" className="chips">
      <Link href="/files" className="chip" aria-current={!kind ? "true" : undefined}>
        <span>All <i>{all.length}</i></span>
      </Link>
      {SHARED_FILE_KINDS.map((k) => {
        const n = all.filter((f) => f.kind === k).length;
        if (n === 0) return null;
        return (
          <Link key={k} href={`/files?kind=${k}`} className="chip" aria-current={kind === k ? "true" : undefined}>
            <span>{KIND_TABS[k]} <i>{n}</i></span>
          </Link>
        );
      })}
    </nav>
  );

  if (nora) {
    return (
      <div>
        <PageHeader
          title="Files"
          subtitle="Everything Cameron has sent you. Tap one to open, save or share it."
          actions={<LinkButton href="/contracts" size="sm">New contract</LinkButton>}
        />
        {chips}
        {shown.length === 0 ? (
          <EmptyState title={all.length === 0 ? "Nothing here yet." : "Nothing of that kind."}>Contracts, invoices and anything else Cameron sends you will show up here.</EmptyState>
        ) : (
          <>
            {fresh.length > 0 && (
              <Card title={<>New<Count n={fresh.length} /></>} padded={false}>
                <ul className="list">{fresh.map((f) => <FileRow key={f.id} file={f} isNew />)}</ul>
              </Card>
            )}
            {earlier.length > 0 && (
              <Card title={fresh.length > 0 ? "Earlier" : "All files"} padded={false}>
                <ul className="list">{earlier.map((f) => <FileRow key={f.id} file={f} />)}</ul>
              </Card>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Files for Nora" subtitle="Send her a contract, an invoice or anything else. It lands in her Files tab, marked new until she opens it." />
      <Card title="Send a file">
        <FileSendForm directUpload={blobEnabled()} />
      </Card>
      <Card title={<>Sent{all.length > 0 && <span className="meta num"> {all.length}</span>}</>} padded={false}>
        {all.length === 0 ? (
          <p className="sec-note">Nothing sent yet.</p>
        ) : (
          <>
            <div className="mb-2">{chips}</div>
            <ul className="list">
              {shown.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2.5">
                  <a href={`/files/${f.id}/open`} target="_blank" rel="noopener" className="group min-w-0 flex-1">
                    <span className="row-title block break-words group-hover:underline">{f.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {f.openedAt ? <Status tone="ok" small>Opened {formatDate(f.openedAt)}</Status> : <Status tone="info" small>Not opened yet</Status>}
                      <span className="meta">
                        {KIND_LABEL[f.kind]} · sent {formatDate(f.createdAt)}
                      </span>
                    </span>
                    {f.note && <span className="meta mt-0.5 block break-words">{f.note}</span>}
                  </a>
                  <form action={removeFileAction} className="shrink-0">
                    <input type="hidden" name="id" value={f.id} />
                    <ConfirmButton confirm={`Remove “${f.title}” from Nora's Files?`} variant="ghost" size="sm">Remove</ConfirmButton>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

/** One file in Nora's folder: the whole row opens it in a new tab, where the phone offers Save and Share. */
function FileRow({ file, isNew }: { file: SharedFile; isNew?: boolean }) {
  return (
    <li>
      <a href={`/files/${file.id}/open`} target="_blank" rel="noopener" className="row approve-row">
        <span className="approve-main">
          <span className="row-title">{file.title}</span>
          {file.note && <span className="approve-note max-lg:hidden">{file.note}</span>}
        </span>
        <span className="row-meta">
          {file.note && <span className="lg:hidden">{file.note}</span>}
          <span className="meta where">{isNew ? <Status tone="info" small>New</Status> : KIND_LABEL[file.kind]}</span>
          <span className="meta when">{formatDate(file.createdAt)}</span>
        </span>
        <Chevron />
      </a>
    </li>
  );
}
