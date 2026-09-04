import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inclusiveBusinessDates } from "../../lib/business-date-contract.ts";
import {
  ATLAS_BUSINESS_TIME_ZONE,
  getAtlasBusinessDate,
  getCustomDashboardRange,
  getSingleDateDashboardRange,
  getTodayDashboardRange,
} from "./dashboard-date-model.ts";

test("IST midnight changes the business date at 18:30 UTC, not UTC midnight", () => {
  assert.equal(ATLAS_BUSINESS_TIME_ZONE, "Asia/Kolkata");
  assert.equal(getAtlasBusinessDate(new Date("2026-09-02T18:29:59Z")), "2026-09-02");
  assert.equal(getAtlasBusinessDate(new Date("2026-09-02T18:30:00Z")), "2026-09-03");
});

test("normal daytime and month/year boundaries use the Indian calendar date", () => {
  assert.equal(getAtlasBusinessDate(new Date("2026-09-03T06:30:00Z")), "2026-09-03");
  assert.equal(getAtlasBusinessDate(new Date("2026-08-31T18:30:00Z")), "2026-09-01");
  assert.equal(getAtlasBusinessDate(new Date("2026-12-31T18:30:00Z")), "2027-01-01");
});

test("Today returns the same explicit IST date at both endpoints", () => {
  assert.deepEqual(getTodayDashboardRange(new Date("2026-09-02T18:30:00Z")), {
    dateFrom: "2026-09-03",
    dateTo: "2026-09-03",
  });
});

test("host timezone does not change IST Today or supplied calendar-date selections", () => {
  const modelUrl = new URL("./dashboard-date-model.ts", import.meta.url).href;
  const script = `
    import { getTodayDashboardRange, getSingleDateDashboardRange, getCustomDashboardRange } from ${JSON.stringify(modelUrl)};
    process.stdout.write(JSON.stringify([
      getTodayDashboardRange(new Date("2026-09-02T18:29:59Z")),
      getTodayDashboardRange(new Date("2026-09-02T18:30:00Z")),
      getSingleDateDashboardRange("2026-09-03"),
      getCustomDashboardRange("2026-08-01", "2026-08-31"),
    ]));
  `;
  for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
      env: { ...process.env, TZ: timezone, NODE_NO_WARNINGS: "1" },
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(output), [
      { dateFrom: "2026-09-02", dateTo: "2026-09-02" },
      { dateFrom: "2026-09-03", dateTo: "2026-09-03" },
      { dateFrom: "2026-09-03", dateTo: "2026-09-03" },
      { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
    ], timezone);
  }
});

test("single-date selection preserves the supplied date at both endpoints", () => {
  assert.deepEqual(getSingleDateDashboardRange("2026-08-15"), {
    dateFrom: "2026-08-15",
    dateTo: "2026-08-15",
  });
});

test("custom ranges preserve both inclusive endpoints, including a one-day range", () => {
  const range = getCustomDashboardRange("2026-08-31", "2026-09-02");
  assert.deepEqual(range, { dateFrom: "2026-08-31", dateTo: "2026-09-02" });
  assert.deepEqual([...inclusiveBusinessDates(range.dateFrom, range.dateTo)], [
    "2026-08-31", "2026-09-01", "2026-09-02",
  ]);
  assert.deepEqual(getCustomDashboardRange("2026-09-03", "2026-09-03"), {
    dateFrom: "2026-09-03", dateTo: "2026-09-03",
  });
});

test("custom ranges have no arbitrary maximum duration", () => {
  assert.deepEqual(getCustomDashboardRange("2000-01-01", "2100-12-31"), {
    dateFrom: "2000-01-01", dateTo: "2100-12-31",
  });
});

test("reversed ranges fail explicitly instead of silently swapping", () => {
  assert.throws(() => getCustomDashboardRange("2026-09-03", "2026-09-02"), {
    message: "dateFrom must not be after dateTo.",
  });
});

test("single-date and both range endpoints use the existing business-date validation", () => {
  for (const invalidDate of ["", "2026-9-03", "03/09/2026", "2026-09-03T00:00:00Z", "2026-04-31"]) {
    assert.throws(() => getSingleDateDashboardRange(invalidDate), {
      message: "businessDate must be a valid YYYY-MM-DD business date.",
    });
    assert.throws(() => getCustomDashboardRange(invalidDate, "2026-09-30"), {
      message: "dateFrom must be a valid YYYY-MM-DD business date.",
    });
    assert.throws(() => getCustomDashboardRange("2026-09-01", invalidDate), {
      message: "dateTo must be a valid YYYY-MM-DD business date.",
    });
  }
});

test("valid leap days are preserved and non-leap February 29 is rejected", () => {
  assert.deepEqual(getSingleDateDashboardRange("2028-02-29"), {
    dateFrom: "2028-02-29", dateTo: "2028-02-29",
  });
  assert.throws(() => getSingleDateDashboardRange("2026-02-29"), /valid YYYY-MM-DD business date/);
  assert.equal(getAtlasBusinessDate(new Date("2028-02-28T18:30:00Z")), "2028-02-29");
});

test("date model stays pure and contains only the three approved selection modes", () => {
  const source = readFileSync(new URL("./dashboard-date-model.ts", import.meta.url), "utf8");
  assert.match(source, /DashboardDateMode = "today" \| "single-date" \| "range"/);
  assert.doesNotMatch(source, /getLocalDate|getFullYear|getMonth|getDate|toISOString|supabase|\/services\/|dashboard-container|compensation|cash-book|react|fetch\(/i);
  assert.equal((source.match(/Asia\/Kolkata/g) ?? []).length, 1);
});
