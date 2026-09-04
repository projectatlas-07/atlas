export function toFiniteNumber(value: number | string, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${label} returned an invalid numeric value.`);
  return numeric;
}

export function sumFiniteNumbers(
  values: Iterable<number | string>,
  label: string,
): number {
  let total = 0;
  for (const value of values) total += toFiniteNumber(value, label);
  return total;
}
