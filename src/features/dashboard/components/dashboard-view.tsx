import { Card } from "../../../components/ui/card";
import { EmptyState } from "../../../components/ui/feedback";
import {
  buildDashboardPresentation,
  type DashboardAttentionItem,
  type DashboardSummary,
} from "../dashboard-view-model";
import type { OwnerDashboardSnapshot } from "../types";

export interface DashboardViewProps {
  snapshot: OwnerDashboardSnapshot;
}

const SUMMARY_LINK_CLASSES = [
  "group block min-h-atlas-12 rounded-atlas-control",
  "focus-visible:outline-none focus-visible:ring-atlas-focus focus-visible:ring-offset-atlas-focus",
].join(" ");

export function DashboardView({ snapshot }: Readonly<DashboardViewProps>) {
  const presentation = buildDashboardPresentation(snapshot);

  return (
    <div className="space-y-atlas-8">
      <section aria-labelledby="dashboard-today-heading">
        <SectionHeading
          id="dashboard-today-heading"
          title="Today"
          description={`Recorded position for ${presentation.todayDateLabel}.`}
        />
        <Card as="section" aria-label="Today’s recorded activity">
          <div className="grid gap-atlas-6 sm:grid-cols-2 sm:divide-x sm:divide-atlas-border">
            <SummaryLead summary={presentation.todaySales} />
            <div className="sm:pl-atlas-6">
              <p className="text-atlas-sm font-atlas-medium text-atlas-text-muted">Today’s Production</p>
              <p className={`mt-atlas-2 font-atlas-semibold tabular-nums ${presentation.todayProduction.recorded ? "text-atlas-3xl text-atlas-text" : "text-atlas-lg text-atlas-warning-text"}`}>
                {presentation.todayProduction.value}
              </p>
              <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">{presentation.todayProduction.description}</p>
              <DashboardLink href={presentation.todayProduction.href}>Open Production</DashboardLink>
            </div>
          </div>
        </Card>
      </section>

      <section aria-labelledby="dashboard-attention-heading">
        <SectionHeading
          id="dashboard-attention-heading"
          title="Needs attention"
          description="Only open items the current read model can state reliably."
        />
        {presentation.attention.length === 0
          ? <Card surface="muted"><EmptyState title="Nothing needs attention" description="The available Dashboard checks have no open item right now." /></Card>
          : <Card as="section" surface="muted" aria-label="Items needing attention">
              <ul className="divide-y divide-atlas-border">
                {presentation.attention.map((item) => <AttentionRow key={item.title} item={item} />)}
              </ul>
            </Card>}
      </section>

      <section aria-labelledby="dashboard-overview-heading">
        <SectionHeading
          id="dashboard-overview-heading"
          title="Overview"
          description="Useful totals from the existing authoritative modules."
        />
        <div className="grid gap-atlas-4 lg:grid-cols-2">
          <Card as="article">
            <SummaryLead summary={presentation.thisWeekSales} />
          </Card>
          <Card as="section" aria-labelledby="dashboard-position-heading">
            <h4 id="dashboard-position-heading" className="text-atlas-base font-atlas-semibold text-atlas-text">Current position</h4>
            <div className="mt-atlas-3 divide-y divide-atlas-border">
              {presentation.currentPosition.map((summary) => <SummaryRow key={summary.label} summary={summary} />)}
            </div>
          </Card>
        </div>
      </section>

      <section aria-labelledby="dashboard-activity-heading">
        <SectionHeading
          id="dashboard-activity-heading"
          title="Today’s recorded money activity"
          description="Recorded flows only; these are not a reconstructed activity feed."
        />
        <Card as="section">
          {presentation.hasRecordedActivity
            ? <div className="divide-y divide-atlas-border">{presentation.activity.map((summary) => <SummaryRow key={summary.label} summary={summary} />)}</div>
            : <EmptyState title="No money activity recorded today" description="No customer payment, expense, Cash In, or Cash Out value is available for today." />}
        </Card>
      </section>
    </div>
  );
}

function SectionHeading({ id, title, description }: Readonly<{ id: string; title: string; description: string }>) {
  return (
    <div className="mb-atlas-3">
      <h3 id={id} className="text-atlas-xl font-atlas-semibold text-atlas-text">{title}</h3>
      <p className="mt-atlas-1 text-atlas-sm text-atlas-text-muted">{description}</p>
    </div>
  );
}

function SummaryLead({ summary }: Readonly<{ summary: DashboardSummary }>) {
  return (
    <div>
      <p className="text-atlas-sm font-atlas-medium text-atlas-text-muted">{summary.label}</p>
      <p className="mt-atlas-2 text-atlas-3xl font-atlas-semibold tabular-nums text-atlas-text">{summary.value}</p>
      <p className="mt-atlas-2 text-atlas-sm text-atlas-text-muted">{summary.description}</p>
      <DashboardLink href={summary.href}>Open {summary.label.replace(/^Today’s |^This Week’s /, "")}</DashboardLink>
    </div>
  );
}

function SummaryRow({ summary }: Readonly<{ summary: DashboardSummary }>) {
  return (
    <a href={summary.href} className={`${SUMMARY_LINK_CLASSES} flex items-center justify-between gap-atlas-4 py-atlas-3`}>
      <span>
        <span className="block text-atlas-sm font-atlas-semibold text-atlas-text group-hover:text-atlas-primary">{summary.label}</span>
        <span className="mt-atlas-1 block text-atlas-xs text-atlas-text-muted">{summary.description}</span>
      </span>
      <span className="shrink-0 text-right text-atlas-base font-atlas-semibold tabular-nums text-atlas-text">{summary.value}</span>
    </a>
  );
}

function AttentionRow({ item }: Readonly<{ item: DashboardAttentionItem }>) {
  return (
    <li className="py-atlas-3 first:pt-atlas-0 last:pb-atlas-0">
      <a href={item.href} className={`${SUMMARY_LINK_CLASSES} flex flex-col justify-between gap-atlas-2 sm:flex-row sm:items-center`}>
        <span>
          <span className="block text-atlas-base font-atlas-semibold text-atlas-text group-hover:text-atlas-primary">{item.title}</span>
          <span className="mt-atlas-1 block text-atlas-sm text-atlas-text-muted">{item.description}</span>
        </span>
        <span className="shrink-0 text-atlas-sm font-atlas-semibold text-atlas-primary">
          {item.value ? <span className="mr-atlas-3 tabular-nums text-atlas-text">{item.value}</span> : null}
          {item.linkLabel}
        </span>
      </a>
    </li>
  );
}

function DashboardLink({ href, children }: Readonly<{ href: DashboardSummary["href"]; children: React.ReactNode }>) {
  return <a href={href} className={`${SUMMARY_LINK_CLASSES} mt-atlas-3 inline-flex items-center font-atlas-semibold text-atlas-primary hover:text-atlas-primary-hover`}>{children}</a>;
}
