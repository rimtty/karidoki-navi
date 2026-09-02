/**
 * Round a value at the presentation boundary.  Domain calculations retain
 * the original floating-point sum; callers should invoke this only while
 * building UI/API display models.
 */
export function roundForDisplay(value: number, fractionDigits = 1): number {
  if (!Number.isFinite(value)) throw new RangeError("display value must be finite");
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 20) {
    throw new RangeError("fractionDigits must be an integer from 0 to 20");
  }
  const rounded = Number(value.toFixed(fractionDigits));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export const roundTemperatureForDisplay = roundForDisplay;
export const roundAccumulatedTemperatureForDisplay = roundForDisplay;
