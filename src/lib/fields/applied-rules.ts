import type { FieldViewModel } from "@/features/fields/view-model";
import { addLocalDays } from "../../domain/dates";

export interface AppliedRuleRow {
  crop_season_id: string;
  harvest_start_temp_c: number;
  harvest_target_temp_c: number;
  harvest_end_temp_c: number;
  accumulation_start_offset_days: number;
  source_title: string;
  source_note?: string | null;
}

/** Display the season's saved values, never today's editable variety master. */
export function attachAppliedRules(fields: FieldViewModel[], rows: AppliedRuleRow[]): FieldViewModel[] {
  const bySeason = new Map(rows.map((row) => [row.crop_season_id, row]));
  return fields.map((field) => {
    const row = field.seasonId ? bySeason.get(field.seasonId) : undefined;
    if (!row) return field;
    return {
      ...field,
      rule: {
        startTempC: row.harvest_start_temp_c,
        targetTempC: row.harvest_target_temp_c,
        endTempC: row.harvest_end_temp_c,
        accumulationOffsetDays: row.accumulation_start_offset_days,
        label: "この田んぼに適用中の目安",
        source: row.source_note?.trim() || row.source_title,
      },
      accumulationStartDate: field.headingDate
        ? addLocalDays(field.headingDate, row.accumulation_start_offset_days) : null,
      remainingTempC: field.accumulatedTempC === null ? null
        : Math.max(0, row.harvest_start_temp_c - field.accumulatedTempC),
    };
  });
}
