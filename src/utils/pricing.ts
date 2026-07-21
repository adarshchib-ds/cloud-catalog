/**
 * Global Pricing Utility
 * Defines standard calculations for price fluctuation and ranges across the application.
 */

export interface PriceRange {
  min: number;
  max: number;
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
