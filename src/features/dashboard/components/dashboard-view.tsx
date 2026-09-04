import { buildDashboardPresentation } from "../dashboard-view-model";
import type { DashboardSnapshot } from "../types";

export interface DashboardViewProps {
  snapshot: DashboardSnapshot;
}

export function DashboardView({ snapshot }: Readonly<DashboardViewProps>) {
  const presentation = buildDashboardPresentation(snapshot);

  return (
    <section aria-labelledby="dashboard-heading" className="space-y-8">
      <header>
        <h2 id="dashboard-heading" className="text-2xl font-bold text-slate-950">Dashboard</h2>
        <p className="mt-1 text-sm text-slate-600">{presentation.periodLabel}</p>
      </header>

      <DashboardSection
        heading="Business Activity"
        description="Activity recorded during the selected period."
        cards={presentation.businessActivity}
      />
      <DashboardSection
        heading="Current Position"
        description="Current balances shown separately from period activity."
        cards={presentation.currentPosition}
        current
      />
    </section>
  );
}

function DashboardSection({
  heading,
  description,
  cards,
  current = false,
}: Readonly<{
  heading: string;
  description: string;
  cards: Array<{ label: string; value: string; helperText?: string }>;
  current?: boolean;
}>) {
  const headingId = `dashboard-${heading.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <section aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="text-xl font-bold text-slate-950">{heading}</h3>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      <div className={`mt-4 grid gap-4 sm:grid-cols-2 ${current ? "xl:grid-cols-2" : "xl:grid-cols-3"}`}>
        {cards.map((card) => <MetricCard key={card.label} {...card} current={current} />)}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  helperText,
  current,
}: Readonly<{
  label: string;
  value: string;
  helperText?: string;
  current: boolean;
}>) {
  return (
    <article aria-label={label} className={`rounded-xl border bg-white p-5 shadow-sm ${current ? "border-cyan-200" : "border-slate-200"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-extrabold tabular-nums text-slate-950">{value}</p>
      {helperText && <p className="mt-3 text-xs leading-5 text-slate-600">{helperText}</p>}
    </article>
  );
}
