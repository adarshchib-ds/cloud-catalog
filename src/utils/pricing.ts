export const MONTHLY_HOURS = 720;

export interface PriceRange {
  min: number;
  max: number;
}

export interface DetailedPricingInfo {
  hourlyCost: number | null;
  monthlyCost: number | null;
  onDemandHourlyCostMin: number | null;
  onDemandHourlyCostMax: number | null;
  onDemandMonthlyCostMin: number | null;
  onDemandMonthlyCostMax: number | null;
  formattedHourly: string | null;
  formattedMonthly: string | null;
  formattedRange: string | null;
}

/**
 * Calculates a dynamic price range around a base price using a uniform ±10% fluctuation.
 *
 * @param basePrice The single resolved cost from the database.
 * @returns An object containing the calculated minimum and maximum prices.
 */
export function calculatePriceRange(basePrice: number): PriceRange {
  if (!basePrice || basePrice <= 0) {
    return { min: 0, max: 0 };
  }
  return {
    min: basePrice * 0.9,
    max: basePrice * 1.1,
  };
}

function formatNum(num: number, decimals: number): string {
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Global backend calculation helper to resolve hourly/monthly costs,
 * min/max range bounds, and pre-formatted text representations.
 */
export function calculateDetailedPricing(hourlyCost: number | null | undefined): DetailedPricingInfo {
  if (hourlyCost === null || hourlyCost === undefined || Number(hourlyCost) <= 0) {
    return {
      hourlyCost: null,
      monthlyCost: null,
      onDemandHourlyCostMin: null,
      onDemandHourlyCostMax: null,
      onDemandMonthlyCostMin: null,
      onDemandMonthlyCostMax: null,
      formattedHourly: null,
      formattedMonthly: null,
      formattedRange: null,
    };
  }

  const base = Number(hourlyCost);
  const monthly = base * MONTHLY_HOURS;
  const range = calculatePriceRange(base);
  const monthlyMin = range.min * MONTHLY_HOURS;
  const monthlyMax = range.max * MONTHLY_HOURS;

  const formattedHourly =
    range.min === range.max
      ? `$${formatNum(base, 4)} / hr`
      : `$${formatNum(range.min, 4)} - $${formatNum(range.max, 4)} / hr`;

  const formattedMonthly =
    range.min === range.max
      ? `$${formatNum(monthly, 2)} / mo`
      : `$${formatNum(monthlyMin, 2)} - $${formatNum(monthlyMax, 2)} / mo`;

  const formattedRange = `${formattedHourly} (≈ ${formattedMonthly})`;

  return {
    hourlyCost: Number(base.toFixed(4)),
    monthlyCost: Number(monthly.toFixed(2)),
    onDemandHourlyCostMin: Number(range.min.toFixed(4)),
    onDemandHourlyCostMax: Number(range.max.toFixed(4)),
    onDemandMonthlyCostMin: Number(monthlyMin.toFixed(2)),
    onDemandMonthlyCostMax: Number(monthlyMax.toFixed(2)),
    formattedHourly,
    formattedMonthly,
    formattedRange,
  };
}

