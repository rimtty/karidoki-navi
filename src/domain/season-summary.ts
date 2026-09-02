import { calculateAccumulation } from "./accumulation";
import { determineDataStatus } from "./data-status";
import { maxLocalDate } from "./dates";
import { estimateDaysToStart } from "./estimation";
import { determineMaturityStatus } from "./maturity";
import { normalizeObservations } from "./observations";
import type { SeasonSummary, SeasonSummaryInput } from "./types";

/** Compose the pure domain calculations used by a season detail/map card. */
export function calculateSeasonSummary(input: SeasonSummaryInput): SeasonSummary {
  const observations = input.dailyValues ?? input.observations ?? [];
  const accumulation = calculateAccumulation({
    headingDate: input.headingDate,
    observations,
    accumulationStartOffsetDays: input.rule?.accumulationStartOffsetDays ?? 1,
    throughDate: input.throughDate,
  });
  const normalized = normalizeObservations(observations);
  const latestObservedDate = maxLocalDate(
    normalized.map((observation) => observation.date),
  );
  const asOfDate = input.asOfDate ?? input.throughDate ?? latestObservedDate;

  const dataStatus = determineDataStatus({
    pending: input.pending,
    error: input.error,
    missingDayCount: accumulation.missingDayCount,
    latestObservedDate,
    asOfDate,
  });

  const maturityInput = {
    headingDate: input.headingDate,
    harvestDate: input.harvestDate,
    rule: input.rule,
    accumulationStartDate: accumulation.accumulationStartDate,
    throughDate: accumulation.throughDate,
    asOfDate,
    accumulatedTempC: accumulation.accumulatedTempC,
    ...(Object.prototype.hasOwnProperty.call(input, "weatherLocationId")
      ? { weatherLocationId: input.weatherLocationId }
      : {}),
  };

  return {
    accumulation,
    dataStatus,
    maturityStatus: determineMaturityStatus(maturityInput),
    estimatedDaysToStart: input.rule
      ? estimateDaysToStart({
          accumulatedTempC: accumulation.accumulatedTempC,
          harvestStartTempC: input.rule.harvestStartTempC,
          recentValues: observations,
          asOfDate,
        })
      : null,
  };
}

export const buildSeasonSummary = calculateSeasonSummary;
