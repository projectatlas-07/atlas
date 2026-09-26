import assert from "node:assert/strict";
import test from "node:test";

import {
  ATLAS_MISSING_VALUE,
  formatDateOnly,
  formatIndianCurrency,
  formatIndianNumber,
  formatKolkataDateTime,
} from "./formatting.ts";

test("formatIndianNumber uses lakh and crore grouping", () => {
  assert.equal(formatIndianNumber(123_456), "1,23,456");
  assert.equal(formatIndianNumber(12_345_678), "1,23,45,678");
  assert.equal(formatIndianNumber(123_456_789n), "12,34,56,789");
});

test("numeric formatters define zero, negative, decimal, and missing values", () => {
  assert.equal(formatIndianNumber(0), "0");
  assert.equal(formatIndianNumber(-0), "0");
  assert.equal(formatIndianNumber(-123_456.7894), "-1,23,456.789");
  assert.equal(formatIndianNumber(null), ATLAS_MISSING_VALUE);

  assert.equal(formatIndianCurrency(0), "₹0");
  assert.equal(formatIndianCurrency(-0), "₹0");
  assert.equal(formatIndianCurrency(-123_456.5), "-₹1,23,456.5");
  assert.equal(formatIndianCurrency(1_234.567), "₹1,234.57");
  assert.equal(formatIndianCurrency(undefined), ATLAS_MISSING_VALUE);
});

test("financial decimals can be rendered deterministically with fixed paise", () => {
  assert.equal(
    formatIndianCurrency(1_234.5, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    "₹1,234.50",
  );
  assert.equal(
    formatIndianCurrency(-1.005, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    "-₹1.01",
  );
});

test("financial output uses Latin digits compatible with tabular numerals", () => {
  const output = formatIndianCurrency(-12_345.67);
  assert.match(output, /^-?₹[0-9,.]+$/);
});

test("formatDateOnly preserves business dates without timezone conversion", () => {
  assert.equal(formatDateOnly("2026-09-02"), "02/09/2026");
  assert.equal(formatDateOnly("2028-02-29"), "29/02/2028");
  assert.equal(formatDateOnly(null), ATLAS_MISSING_VALUE);
  assert.throws(() => formatDateOnly("2026-02-29"), /valid YYYY-MM-DD/);
  assert.throws(
    () => formatDateOnly("2026-09-02T00:00:00Z"),
    /valid YYYY-MM-DD/,
  );
});

test("formatKolkataDateTime handles the UTC/Kolkata date boundary", () => {
  assert.equal(
    formatKolkataDateTime("2025-12-31T18:29:59Z", {
      includeSeconds: true,
    }),
    "31/12/2025, 23:59:59",
  );
  assert.equal(
    formatKolkataDateTime("2025-12-31T18:30:00Z", {
      includeSeconds: true,
    }),
    "01/01/2026, 00:00:00",
  );
  assert.equal(
    formatKolkataDateTime("2026-01-01T00:00:00+05:30"),
    "01/01/2026, 00:00",
  );
});

test("timestamp formatting rejects ambiguous or invalid inputs", () => {
  assert.equal(formatKolkataDateTime(undefined), ATLAS_MISSING_VALUE);
  assert.throws(
    () => formatKolkataDateTime("2026-01-01T00:00:00"),
    /explicit UTC offset/,
  );
  assert.throws(
    () => formatKolkataDateTime("2026-01-01"),
    /explicit UTC offset/,
  );
  assert.throws(
    () => formatKolkataDateTime("not-a-timestampZ"),
    /valid instant/,
  );
});
