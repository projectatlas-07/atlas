export function calculateProductionWage(quantity: number, ratePer1000Bricks: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error("Quantity must be greater than or equal to zero.");
  }
  if (!Number.isFinite(ratePer1000Bricks) || ratePer1000Bricks <= 0) {
    throw new Error("Rate per 1,000 bricks must be greater than zero.");
  }

  return (quantity / 1000) * ratePer1000Bricks;
}
