import { requireUser } from "@/lib/auth";
import { listClients } from "@/lib/data";
import { currentMonth } from "@/lib/dates";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { NumbersSheet, type SheetMetric, type SheetPlatform } from "@/components/numbers-sheet";
import { listMetricRows, rangeMonths, resolveEnd } from "./queries";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const METRICS: SheetMetric[] = ["views", "reach", "followers", "engagements"];

export default async function NumbersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const end = resolveEnd(one(sp.end));
  const metric = (METRICS as string[]).includes(one(sp.metric)) ? (one(sp.metric) as SheetMetric) : "views";
  const platform: SheetPlatform = one(sp.platform) === "tiktok" ? "tiktok" : "instagram";
  const months = rangeMonths(end);

  const [clients, rows] = await Promise.all([listClients(), listMetricRows(months)]);

  return (
    <>
      <PageHeader title="Numbers" subtitle="Type each business's monthly numbers. Everything saves as you go." />
      {clients.length === 0 ? (
        <EmptyState title="No businesses yet">
          <LinkButton href="/clients" size="sm" className="mt-3">Add a business</LinkButton>
        </EmptyState>
      ) : (
        <NumbersSheet
          key={end}
          end={end}
          current={currentMonth()}
          months={months}
          initialMetric={metric}
          initialPlatform={platform}
          clients={clients.map((c) => ({ id: c.id, name: c.name, location: c.location }))}
          rows={rows}
        />
      )}
    </>
  );
}
