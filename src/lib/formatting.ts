import { isLocalDate } from "./local-date.ts";

export const ATLAS_LOCALE = "en-IN";
export const ATLAS_TIME_ZONE = "Asia/Kolkata";
export const ATLAS_MISSING_VALUE = "—";

type NumericValue = number | bigint;
type OptionalNumericValue = NumericValue | null | undefined;

export interface AtlasNumericFormatOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  missingValue?: string;
}

export interface AtlasDateTimeFormatOptions {
  includeSeconds?: boolean;
  missingValue?: string;
}

const EXPLICIT_TIME_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;

function resolveFractionDigits(
  options: AtlasNumericFormatOptions,
  defaultMaximumFractionDigits: number,
) {
  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  const maximumFractionDigits =
    options.maximumFractionDigits ??
    Math.max(defaultMaximumFractionDigits, minimumFractionDigits);

  for (const value of [minimumFractionDigits, maximumFractionDigits]) {
    if (!Number.isInteger(value) || value < 0 || value > 20) {
      throw new RangeError("Fraction digits must be an integer from 0 to 20.");
    }
  }

  if (minimumFractionDigits > maximumFractionDigits) {
    throw new RangeError(
      "minimumFractionDigits cannot exceed maximumFractionDigits.",
    );
  }

  return { minimumFractionDigits, maximumFractionDigits };
}

function normalizeNumericValue(value: NumericValue): NumericValue {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError("Numeric values must be finite.");
    }

    return Object.is(value, -0) ? 0 : value;
  }

  return value;
}

function isNegative(value: NumericValue) {
  return typeof value === "bigint" ? value < 0n : value < 0;
}

function absoluteValue(value: NumericValue): NumericValue {
  if (!isNegative(value)) {
    return value;
  }

  return typeof value === "bigint" ? -value : Math.abs(value);
}

function createIndianNumberFormatter(
  options: AtlasNumericFormatOptions,
  defaultMaximumFractionDigits: number,
) {
  const fractionDigits = resolveFractionDigits(
    options,
    defaultMaximumFractionDigits,
  );

  return new Intl.NumberFormat(ATLAS_LOCALE, {
    numberingSystem: "latn",
    useGrouping: true,
    ...fractionDigits,
  });
}

/**
 * Formats a presentation-only number using the Indian lakh/crore grouping system.
 * Missing values render as an em dash; zero remains "0" and negative zero is
 * normalized to zero. The default preserves up to three decimal places.
 */
export function formatIndianNumber(
  value: OptionalNumericValue,
  options: AtlasNumericFormatOptions = {},
) {
  if (value == null) {
    return options.missingValue ?? ATLAS_MISSING_VALUE;
  }

  return createIndianNumberFormatter(options, 3).format(
    normalizeNumericValue(value),
  );
}

/**
 * Formats a presentation-only INR amount with Indian grouping. The default
 * omits unnecessary trailing zeroes and rounds to at most two decimal places.
 * Use { minimumFractionDigits: 2, maximumFractionDigits: 2 } where paise must
 * always be shown.
 */
export function formatIndianCurrency(
  value: OptionalNumericValue,
  options: AtlasNumericFormatOptions = {},
) {
  if (value == null) {
    return options.missingValue ?? ATLAS_MISSING_VALUE;
  }

  const normalizedValue = normalizeNumericValue(value);
  const sign = isNegative(normalizedValue) ? "-" : "";
  const formattedValue = createIndianNumberFormatter(options, 2).format(
    absoluteValue(normalizedValue),
  );

  return `${sign}₹${formattedValue}`;
}

/**
 * Formats a database business date without constructing a Date object. This is
 * intentionally timezone-free so a YYYY-MM-DD value can never move to another
 * calendar day.
 */
export function formatDateOnly(
  value: string | null | undefined,
  missingValue = ATLAS_MISSING_VALUE,
) {
  if (value == null || value === "") {
    return missingValue;
  }

  if (!isLocalDate(value)) {
    throw new RangeError("Date-only values must use a valid YYYY-MM-DD date.");
  }

  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function parseTimestamp(value: string | Date) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError("Timestamp must be a valid instant.");
    }

    return value;
  }

  if (!EXPLICIT_TIME_ZONE_PATTERN.test(value)) {
    throw new RangeError(
      "Timestamp strings must include Z or an explicit UTC offset.",
    );
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new RangeError("Timestamp must be a valid instant.");
  }

  return timestamp;
}

/**
 * Formats an actual instant in Asia/Kolkata as DD/MM/YYYY, HH:mm[:ss]. String
 * inputs must include Z or an explicit offset to avoid host-timezone ambiguity.
 */
export function formatKolkataDateTime(
  value: string | Date | null | undefined,
  options: AtlasDateTimeFormatOptions = {},
) {
  if (value == null || value === "") {
    return options.missingValue ?? ATLAS_MISSING_VALUE;
  }

  const includeSeconds = options.includeSeconds ?? false;
  const parts = new Intl.DateTimeFormat(ATLAS_LOCALE, {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: ATLAS_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  }).formatToParts(parseTimestamp(value));

  const valueByPart = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const date = `${valueByPart.day}/${valueByPart.month}/${valueByPart.year}`;
  const time = `${valueByPart.hour}:${valueByPart.minute}`;
  const seconds = includeSeconds ? `:${valueByPart.second}` : "";

  return `${date}, ${time}${seconds}`;
}
