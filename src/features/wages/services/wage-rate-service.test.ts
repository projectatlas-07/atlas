import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMondayWeekStart,
  getActiveRate,
  getWageRateHistoryStatus,
  WageRateResolutionError,
  type WageRate,
} from "./wage-rate-service.ts";

const productionHistoricalRate: WageRate = {
  id: "production-historical",
  applies_to: "production",
  rate_per_1000_bricks: 80,
  effective_from: "2026-01-05",
  effective_to: "2026-06-29",
};

const productionCurrentRate: WageRate = {
  id: "production-current",
  applies_to: "production",
  rate_per_1000_bricks: 100,
  effective_from: "2026-07-06",
  effective_to: null,
};

const mudSupplyRate: WageRate = {
  id: "mud-supply-current",
  applies_to: "mud_supply",
  rate_per_1000_bricks: 60,
  effective_from: "2026-01-05",
  effective_to: null,
};

const rates = [productionHistoricalRate, productionCurrentRate, mudSupplyRate];

test("resolves the production rate for a week", () => {
  assert.equal(getActiveRate(rates, "production", "2026-08-03"), productionCurrentRate);
});

test("resolves the mud-supply rate independently", () => {
  assert.equal(getActiveRate(rates, "mud_supply", "2026-08-03"), mudSupplyRate);
});

test("resolves the previous historical rate", () => {
  assert.equal(getActiveRate(rates, "production", "2026-06-29"), productionHistoricalRate);
});

test("resolves an open-ended current rate", () => {
  assert.equal(getActiveRate(rates, "production", "2026-12-28"), productionCurrentRate);
});

test("treats effective_from as inclusive", () => {
  assert.equal(getActiveRate(rates, "production", "2026-07-06"), productionCurrentRate);
});

test("treats effective_to as inclusive", () => {
  assert.equal(getActiveRate(rates, "production", "2026-06-29"), productionHistoricalRate);
});

test("carries one unchanged rate across subsequent weeks", () => {
  const unchangedRate: WageRate = {
    id: "production-2026-07-27",
    applies_to: "production",
    rate_per_1000_bricks: 500,
    effective_from: "2026-07-27",
    effective_to: null,
  };

  assert.equal(getActiveRate([unchangedRate], "production", "2026-07-27"), unchangedRate);
  assert.equal(getActiveRate([unchangedRate], "production", "2026-08-03"), unchangedRate);
});

test("resolves continuous production and mud histories across a later replacement", () => {
  const productionPrevious: WageRate = {
    id: "production-500",
    applies_to: "production",
    rate_per_1000_bricks: 500,
    effective_from: "2026-07-27",
    effective_to: "2026-08-09",
  };
  const productionReplacement: WageRate = {
    id: "production-530",
    applies_to: "production",
    rate_per_1000_bricks: 530,
    effective_from: "2026-08-10",
    effective_to: null,
  };
  const mudPrevious: WageRate = {
    id: "mud-230",
    applies_to: "mud_supply",
    rate_per_1000_bricks: 230,
    effective_from: "2026-07-27",
    effective_to: "2026-08-09",
  };
  const mudReplacement: WageRate = {
    id: "mud-240",
    applies_to: "mud_supply",
    rate_per_1000_bricks: 240,
    effective_from: "2026-08-10",
    effective_to: null,
  };
  const continuousRates = [productionPrevious, productionReplacement, mudPrevious, mudReplacement];

  assert.equal(getActiveRate(continuousRates, "production", "2026-08-03"), productionPrevious);
  assert.equal(getActiveRate(continuousRates, "production", "2026-08-10"), productionReplacement);
  assert.equal(getActiveRate(continuousRates, "mud_supply", "2026-08-03"), mudPrevious);
  assert.equal(getActiveRate(continuousRates, "mud_supply", "2026-08-10"), mudReplacement);
});

test("throws when no rate applies", () => {
  assert.throws(
    () => getActiveRate(rates, "production", "2025-12-29"),
    (error) => error instanceof WageRateResolutionError
      && error.failure === "missing"
      && /No production wage rate applies to week starting 2025-12-29/.test(error.message),
  );
});

test("throws when applicable rates overlap", () => {
  const overlappingRate: WageRate = {
    id: "production-overlap",
    applies_to: "production",
    rate_per_1000_bricks: 110,
    effective_from: "2026-07-20",
    effective_to: null,
  };

  assert.throws(
    () => getActiveRate([...rates, overlappingRate], "production", "2026-08-03"),
    (error) => error instanceof WageRateResolutionError
      && error.failure === "overlapping"
      && /Overlapping production wage rates apply to week starting 2026-08-03/.test(error.message),
  );
});

test("ignores rates for the other applies_to", () => {
  assert.throws(
    () => getActiveRate([mudSupplyRate], "production", "2026-08-03"),
    /No production wage rate applies to week starting 2026-08-03/,
  );
});

test("reports a missing mud-supply rate explicitly", () => {
  assert.throws(
    () => getActiveRate([productionCurrentRate], "mud_supply", "2026-08-03"),
    (error) => error instanceof WageRateResolutionError && error.failure === "missing",
  );
});

test("accepts a Monday week_start", () => {
  assert.doesNotThrow(() => assertMondayWeekStart("2026-08-03"));
});

test("rejects every non-Monday weekday", () => {
  for (const date of ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"]) {
    assert.throws(() => assertMondayWeekStart(date), /week_start must be a Monday/);
  }
});

test("rejects malformed and impossible week_start dates", () => {
  assert.throws(() => assertMondayWeekStart("2026-8-03"), /Use a valid YYYY-MM-DD Monday/);
  assert.throws(() => assertMondayWeekStart("2026-02-30"), /week_start must be a Monday/);
});

test("validates week_start as a local calendar date instead of converting from UTC", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";

  try {
    assert.doesNotThrow(() => assertMondayWeekStart("2026-08-03"));
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});

test("labels an applicable open-ended rate as current", () => {
  assert.equal(getWageRateHistoryStatus(productionCurrentRate, "2026-08-03"), "current");
});

test("labels a future open-ended rate as future", () => {
  const futureRate: WageRate = {
    id: "production-future",
    applies_to: "production",
    rate_per_1000_bricks: 120,
    effective_from: "2026-08-17",
    effective_to: null,
  };

  assert.equal(getWageRateHistoryStatus(futureRate, "2026-08-03"), "future");
});

test("labels an ended rate as historical", () => {
  assert.equal(getWageRateHistoryStatus(productionHistoricalRate, "2026-08-03"), "historical");
});
