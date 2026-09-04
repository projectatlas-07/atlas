import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";

const dateModel = await import("./dashboard-date-model.ts");
const todayRange = { dateFrom: "2026-09-03", dateTo: "2026-09-03" };
let todayCalls = 0;
await mock.module("./dashboard-date-model.ts", {
  namedExports: {
    ...dateModel,
    getTodayDashboardRange: () => {
      todayCalls += 1;
      return todayRange;
    },
  },
});
const { resolveDashboardDateSelection } = await import("./dashboard-date-controls-model.ts");
const source = readFileSync(new URL("./components/dashboard-date-controls.tsx", import.meta.url), "utf8");
const modelSource = readFileSync(new URL("./dashboard-date-controls-model.ts", import.meta.url), "utf8");
const range = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };

test("renders exactly Today, Single Date, and Date Range as controlled mode options", () => {
  assert.deepEqual([...source.matchAll(/value: "([^"]+)", label: "([^"]+)"/g)].map((match) => match.slice(1)), [
    ["today", "Today"], ["single-date", "Single Date"], ["range", "Date Range"],
  ]);
  assert.match(source, /aria-pressed=\{mode === option.value\}/);
  assert.match(source, /onClick=\{\(\) => select\(option.value, range\)\}/);
  assert.match(source, />\{option.label\}<\/button>/);
});

test("Today delegates to D3.4 and returns its range unchanged for emission", () => {
  todayCalls = 0;
  const selection = resolveDashboardDateSelection("today", range);
  assert.strictEqual(selection.range, todayRange);
  assert.equal(selection.error, null);
  assert.equal(todayCalls, 1);
  assert.match(source, /if \(selection.range\) onChange\(nextMode, selection.range\)/);
});

test("Single Date validates and emits the same business date at both endpoints", () => {
  assert.deepEqual(resolveDashboardDateSelection("single-date", range), {
    range: { dateFrom: "2026-08-01", dateTo: "2026-08-01" }, error: null,
  });
  assert.match(modelSource, /getSingleDateDashboardRange\(draft.dateFrom\)/);
});

test("valid Date Range preserves inclusive endpoints without swapping or imposing a maximum", () => {
  assert.deepEqual(resolveDashboardDateSelection("range", range), { range, error: null });
  const longRange = { dateFrom: "2000-01-01", dateTo: "2100-12-31" };
  assert.deepEqual(resolveDashboardDateSelection("range", longRange), { range: longRange, error: null });
  assert.match(modelSource, /getCustomDashboardRange\(draft.dateFrom, draft.dateTo\)/);
});

test("reversed drafts show understandable validation and cannot be emitted", () => {
  const reversed = { dateFrom: "2026-09-03", dateTo: "2026-09-02" };
  assert.deepEqual(resolveDashboardDateSelection("range", reversed), {
    range: null, error: "From date cannot be after To date.",
  });
  assert.deepEqual(reversed, { dateFrom: "2026-09-03", dateTo: "2026-09-02" });
  assert.match(source, /setError\(selection.error\)/);
  assert.match(source, /role="alert"/);
  assert.equal((source.match(/onChange\(nextMode, selection.range\)/g) ?? []).length, 1);
});

test("incomplete drafts stay local until both endpoints are complete and valid", () => {
  for (const draft of [
    { dateFrom: "", dateTo: "2026-09-02" },
    { dateFrom: "2026-09-01", dateTo: "" },
    { dateFrom: "", dateTo: "" },
  ]) {
    assert.deepEqual(resolveDashboardDateSelection("range", draft), { range: null, error: null });
  }
  assert.deepEqual(resolveDashboardDateSelection("single-date", { dateFrom: "", dateTo: "" }), {
    range: null, error: null,
  });
  assert.match(source, /setDraft\(nextDraft\)/);
  assert.deepEqual(resolveDashboardDateSelection("range", range), { range, error: null });
});

test("malformed input produces safe validation instead of internal errors or an emitted range", () => {
  assert.deepEqual(resolveDashboardDateSelection("single-date", { dateFrom: "bad-date", dateTo: "" }), {
    range: null, error: "Choose a valid date for each field.",
  });
});

test("renders supplied mode and range, and resynchronizes drafts when parent selection changes", () => {
  assert.match(source, /useState<DashboardDateRange>\(range\)/);
  assert.match(source, /mode === "single-date"/);
  assert.match(source, /mode === "range"/);
  assert.match(source, /value=\{draft.dateFrom\}/);
  assert.match(source, /value=\{draft.dateTo\}/);
  assert.match(source, /setDraft\(\{ dateFrom: range.dateFrom, dateTo: range.dateTo \}\)/);
  assert.match(source, /\[mode, range.dateFrom, range.dateTo\]/);
  assert.doesNotMatch(source, /setMode|setRange|createContext/);
});

test("control has no fetching, integration, services, or duplicated timezone logic", () => {
  assert.doesNotMatch(`${source}\n${modelSource}`, /getDashboardSnapshot|DashboardContainer|dashboard-query|supabase|\/services\/|compensation|cash-book|getLocalDate|new Date|getFullYear|getMonth|getDate|Intl\.|Asia\/Kolkata|toISOString|fetch\(/i);
  assert.match(source, /type="date"/);
});
