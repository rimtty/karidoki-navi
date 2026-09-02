// Supabase Edge Function: low-frequency JMA AMeDAS import and season refresh.
//
// The function is intentionally service-role only. Configure
// UPDATE_WEATHER_CRON_SECRET in the Supabase Function secret store; never put
// the value in this repository or in a cron SQL file.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  JMA_AMEDAS_PROVIDER_REVISION,
  JMA_AMEDAS_TIME_ZONE,
  JmaAmedasProvider,
  addLocalDays,
  assertLocalDate,
  compareLocalDates,
  dateInTimeZone,
  listLocalDates,
  type DailyWeatherValue,
  type LocalDate,
  type WeatherLocation,
} from "../../../src/features/weather/weather-core.ts";

const LOCATION_PROVIDER = "JMA_AMEDAS";
const DEFAULT_BACKFILL_DAYS = 60;
const MAX_CORRECTION_DAYS = 60;

type SupabaseClient = ReturnType<typeof createClient>;

interface UpdateWeatherRequest {
  /** Limit a run to selected weather_locations.id values. */
  locationIds?: string[];
  /** Retry the previous target day and locations whose latest run failed. */
  retryOnly?: boolean;
  /** Force a rolling correction window (1..60 days). */
  correctionDays?: number;
  /** Used by an operator for a bounded replay; interpreted as a JST date. */
  asOfDate?: LocalDate;
}

interface WeatherLocationRow extends WeatherLocation {
  id: string;
  metadata: Record<string, unknown>;
}

interface RunError {
  locationId: string;
  message: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRequest(value: unknown): UpdateWeatherRequest {
  if (value === null || typeof value !== "object") return {};
  const body = value as Record<string, unknown>;
  const locationIds = Array.isArray(body.locationIds)
    ? body.locationIds.filter((value): value is string => typeof value === "string")
    : undefined;
  const correctionDays =
    typeof body.correctionDays === "number" && Number.isInteger(body.correctionDays)
      ? body.correctionDays
      : undefined;
  const asOfDate = typeof body.asOfDate === "string" ? assertLocalDate(body.asOfDate, "asOfDate") : undefined;
  return {
    locationIds,
    retryOnly: body.retryOnly === true,
    correctionDays,
    asOfDate,
  };
}

function compactRanges(dates: readonly LocalDate[]): Array<{ from: LocalDate; to: LocalDate }> {
  if (dates.length === 0) return [];
  const sorted = [...new Set(dates)].sort();
  const ranges: Array<{ from: LocalDate; to: LocalDate }> = [];
  let from = sorted[0];
  let previous = sorted[0];
  for (const date of sorted.slice(1)) {
    if (addLocalDays(previous, 1) !== date) {
      ranges.push({ from, to: previous });
      from = date;
    }
    previous = date;
  }
  ranges.push({ from, to: previous });
  return ranges;
}

function locationFromRow(row: Record<string, unknown>): WeatherLocationRow {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  // Location coordinates are not needed for a point request, but a valid
  // neutral location keeps the provider boundary explicit. The station list
  // metadata is authoritative when nearest-station selection is used.
  const externalId = String(row.external_id ?? "");
  return {
    id: String(row.id ?? ""),
    provider: LOCATION_PROVIDER,
    externalId,
    name: String(row.name ?? externalId),
    latitude: typeof row.latitude === "number" ? row.latitude : 0,
    longitude: typeof row.longitude === "number" ? row.longitude : 0,
    elevationM: typeof row.elevation_m === "number" ? row.elevation_m : null,
    metadata,
  };
}

async function readJsonBody(request: Request): Promise<UpdateWeatherRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    return asRequest(await request.json());
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

async function getLocations(
  client: SupabaseClient,
  request: UpdateWeatherRequest,
): Promise<WeatherLocationRow[]> {
  let query = client
    .from("weather_locations")
    .select("id, provider, external_id, name, elevation_m, metadata")
    .eq("provider", LOCATION_PROVIDER)
    .eq("is_active", true);
  if (request.locationIds && request.locationIds.length > 0) {
    query = query.in("id", request.locationIds);
  }
  const { data, error } = await query;
  if (error) throw new Error(`weather location query failed: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(locationFromRow);
}

async function relatedSeasonIds(client: SupabaseClient, locationId: string): Promise<string[]> {
  const { data, error } = await client
    .from("season_weather_bindings")
    .select("crop_season_id")
    .eq("weather_location_id", locationId)
    .eq("is_active", true);
  if (error) throw new Error(`season binding query failed: ${error.message}`);
  return [...new Set(
    ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.crop_season_id)
      .filter((value): value is string => typeof value === "string"),
  )];
}

async function earliestConfiguredDate(
  client: SupabaseClient,
  seasonIds: readonly string[],
  fallback: LocalDate,
): Promise<LocalDate> {
  if (seasonIds.length === 0) return fallback;
  const { data, error } = await client
    .from("crop_seasons")
    .select("heading_date")
    .in("id", seasonIds);
  if (error) throw new Error(`crop season query failed: ${error.message}`);
  const dates = ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => row.heading_date)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => assertLocalDate(value, "heading_date"));
  return dates.length > 0 ? dates.sort()[0] : fallback;
}

async function latestFailed(
  client: SupabaseClient,
  locationId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("weather_import_runs")
    .select("succeeded")
    .eq("weather_location_id", locationId)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`weather run query failed: ${error.message}`);
  const latest = (data as Array<Record<string, unknown>> | null)?.[0];
  return latest?.succeeded === false;
}

async function missingDates(
  client: SupabaseClient,
  locationId: string,
  from: LocalDate,
  to: LocalDate,
  targetDate: LocalDate,
  forceCorrection: boolean,
): Promise<LocalDate[]> {
  const { data, error } = await client
    .from("daily_weather")
    .select("observed_date")
    .eq("weather_location_id", locationId)
    .gte("observed_date", from)
    .lte("observed_date", to);
  if (error) throw new Error(`daily weather query failed: ${error.message}`);
  const existing = new Set(
    ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => row.observed_date)
      .filter((value): value is string => typeof value === "string"),
  );
  return listLocalDates(from, to).filter(
    (date) => forceCorrection || date === targetDate || !existing.has(date),
  );
}

function dbDailyRow(locationId: string, value: DailyWeatherValue, importRunId: string) {
  return {
    weather_location_id: locationId,
    observed_date: value.observedDate,
    mean_temp_c: value.meanTempC,
    max_temp_c: value.maxTempC,
    min_temp_c: value.minTempC,
    quality_code: value.qualityCode,
    provider_revision: value.providerRevision ?? JMA_AMEDAS_PROVIDER_REVISION,
    sample_count: value.sampleCount,
    expected_sample_count: value.expectedSampleCount,
    source_metadata: value.sourceMetadata,
    raw_import_id: importRunId,
    fetched_at: new Date().toISOString(),
  };
}

async function recordRunStart(
  client: SupabaseClient,
  locationId: string,
  from: LocalDate,
  to: LocalDate,
  metadata: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await client
    .from("weather_import_runs")
    .insert({
      provider: LOCATION_PROVIDER,
      weather_location_id: locationId,
      date_from: from,
      date_to: to,
      source_revision: JMA_AMEDAS_PROVIDER_REVISION,
      source_metadata: metadata,
    })
    .select("id")
    .single();
  if (error) throw new Error(`weather run insert failed: ${error.message}`);
  return String((data as Record<string, unknown>).id);
}

async function recordRunSuccess(
  client: SupabaseClient,
  runId: string,
  recordsReceived: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await client
    .from("weather_import_runs")
    .update({
      completed_at: new Date().toISOString(),
      succeeded: true,
      records_received: recordsReceived,
      source_metadata: metadata,
    })
    .eq("id", runId);
  if (error) throw new Error(`weather run completion failed: ${error.message}`);
}

async function recordRunFailure(
  client: SupabaseClient,
  runId: string,
  error: unknown,
): Promise<void> {
  const message = errorMessage(error).slice(0, 2_000);
  const { error: updateError } = await client
    .from("weather_import_runs")
    .update({
      completed_at: new Date().toISOString(),
      succeeded: false,
      error_code: "JMA_UNAVAILABLE",
      error_message: message,
    })
    .eq("id", runId);
  if (updateError) throw new Error(`weather run failure update failed: ${updateError.message}`);
}

async function markSeasonErrors(
  client: SupabaseClient,
  seasonIds: readonly string[],
  error: unknown,
): Promise<void> {
  if (seasonIds.length === 0) return;
  const message = errorMessage(error).slice(0, 2_000);
  const { error: updateError } = await client
    .from("crop_season_summaries")
    .upsert(
      seasonIds.map((crop_season_id) => ({
        crop_season_id,
        data_status: "ERROR",
        error_message: message,
        calculated_at: new Date().toISOString(),
      })),
      { onConflict: "crop_season_id" },
    );
  if (updateError) throw new Error(`season error update failed: ${updateError.message}`);
}

async function recalculateSeasons(
  client: SupabaseClient,
  seasonIds: readonly string[],
  asOfDate: LocalDate,
): Promise<string[]> {
  const failures: string[] = [];
  for (const seasonId of seasonIds) {
    const { error } = await client.rpc("recalculate_crop_season_summary", {
      p_crop_season_id: seasonId,
      p_as_of_date: asOfDate,
    });
    if (error) failures.push(`${seasonId}: ${error.message}`);
  }
  return failures;
}

async function processLocation(
  client: SupabaseClient,
  provider: JmaAmedasProvider,
  location: WeatherLocationRow,
  request: UpdateWeatherRequest,
  targetDate: LocalDate,
): Promise<{ locationId: string; imported: number; seasonFailures: string[]; errors: RunError[] }> {
  const seasonIds = await relatedSeasonIds(client, location.id);
  const defaultFrom = addLocalDays(targetDate, -DEFAULT_BACKFILL_DAYS + 1);
  const metadataFromLocation = location.metadata.weather_start_date;
  const fallbackFrom =
    typeof metadataFromLocation === "string" && assertLocalDate(metadataFromLocation, "weather_start_date")
      ? metadataFromLocation
      : await earliestConfiguredDate(client, seasonIds, defaultFrom);
  const correctionDays = request.correctionDays;
  if (correctionDays !== undefined && (!Number.isInteger(correctionDays) || correctionDays < 1 || correctionDays > MAX_CORRECTION_DAYS)) {
    throw new RangeError(`correctionDays must be an integer from 1 to ${MAX_CORRECTION_DAYS}`);
  }
  const forceCorrection = correctionDays !== undefined;
  const from = forceCorrection
    ? addLocalDays(targetDate, -(correctionDays! - 1))
    : compareLocalDates(fallbackFrom, targetDate) > 0
      ? targetDate
      : fallbackFrom;
  const retryTarget = request.retryOnly ? await latestFailed(client, location.id) : true;
  if (!retryTarget && !forceCorrection) {
    return { locationId: location.id, imported: 0, seasonFailures: [], errors: [] };
  }
  const dates = await missingDates(client, location.id, from, targetDate, targetDate, forceCorrection);
  const ranges = compactRanges(dates);
  if (ranges.length === 0) {
    const seasonFailures = await recalculateSeasons(client, seasonIds, targetDate);
    return {
      locationId: location.id,
      imported: 0,
      seasonFailures,
      errors: seasonFailures.map((message) => ({ locationId: location.id, message })),
    };
  }

  let imported = 0;
  const errors: RunError[] = [];
  for (const range of ranges) {
    const runMetadata = {
      provider: LOCATION_PROVIDER,
      endpointKind: "JMA_AMEDAS_POINT_JSON_INTERNAL",
      timeZone: JMA_AMEDAS_TIME_ZONE,
      locationId: location.id,
      stationId: location.externalId,
      requestedFrom: range.from,
      requestedTo: range.to,
      correctionRun: forceCorrection,
    };
    let runId: string | null = null;
    try {
      runId = await recordRunStart(client, location.id, range.from, range.to, runMetadata);
      const values = await provider.fetchDaily(location, range.from, range.to);
      const rows = values.map((value) => dbDailyRow(location.id, value, runId!));
      if (rows.length > 0) {
        const { error } = await client
          .from("daily_weather")
          .upsert(rows, { onConflict: "weather_location_id,observed_date" });
        if (error) throw new Error(`daily weather upsert failed: ${error.message}`);
      }
      imported += rows.length;
      await recordRunSuccess(client, runId, rows.length, {
        ...runMetadata,
        recordsReceived: rows.length,
      });
    } catch (error) {
      if (runId !== null) {
        try {
          await recordRunFailure(client, runId, error);
        } catch (recordError) {
          errors.push({ locationId: location.id, message: errorMessage(recordError) });
        }
      }
      await markSeasonErrors(client, seasonIds, error);
      errors.push({ locationId: location.id, message: errorMessage(error) });
    }
  }

  const seasonFailures = await recalculateSeasons(client, seasonIds, targetDate);
  errors.push(...seasonFailures.map((message) => ({ locationId: location.id, message })));
  if (errors.length > 0) {
    // Do not let a later successful range hide an earlier endpoint failure in
    // the season-level status. The next retry can clear ERROR once all ranges
    // complete.
    await markSeasonErrors(client, seasonIds, errors[0].message);
  }
  return { locationId: location.id, imported, seasonFailures, errors };
}

export async function handleUpdateWeather(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "POST is required" }, 405);
  const expectedSecret = Deno.env.get("UPDATE_WEATHER_CRON_SECRET");
  const authorization = request.headers.get("authorization");
  if (!expectedSecret) return json({ error: "UPDATE_WEATHER_CRON_SECRET is not configured" }, 503);
  if (authorization !== `Bearer ${expectedSecret}`) return json({ error: "unauthorized" }, 401);

  const projectUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!projectUrl || !serviceRoleKey) return json({ error: "Supabase service configuration is missing" }, 503);

  try {
    const requestBody = await readJsonBody(request);
    const targetDate = requestBody.asOfDate
      ? addLocalDays(requestBody.asOfDate, -1)
      : addLocalDays(dateInTimeZone(new Date(), JMA_AMEDAS_TIME_ZONE), -1);
    const client = createClient(projectUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const locations = await getLocations(client, requestBody);
    const provider = new JmaAmedasProvider({
      // The cache is per invocation and still protects retries/in-flight
      // duplicate URLs. The request spacing protects JMA within this run.
      minRequestIntervalMs: 250,
      pointCacheTtlMs: 1_800_000,
      stationListCacheTtlMs: 86_400_000,
    });
    const results = [];
    for (const location of locations) {
      try {
        results.push(await processLocation(client, provider, location, requestBody, targetDate));
      } catch (error) {
        results.push({
          locationId: location.id,
          imported: 0,
          seasonFailures: [],
          errors: [{ locationId: location.id, message: errorMessage(error) }],
        });
      }
    }
    const errors = results.flatMap((result) => result.errors);
    return json({
      ok: errors.length === 0,
      provider: LOCATION_PROVIDER,
      targetDate,
      timeZone: JMA_AMEDAS_TIME_ZONE,
      locationCount: locations.length,
      importedRecordCount: results.reduce((sum, result) => sum + result.imported, 0),
      results,
      errors,
    }, errors.length === 0 ? 200 : 207);
  } catch (error) {
    return json({ ok: false, error: errorMessage(error) }, 500);
  }
}

Deno.serve(handleUpdateWeather);
