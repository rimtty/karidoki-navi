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
  dateInTimeZone,
  listLocalDates,
  type DailyWeatherValue,
  type LocalDate,
  type WeatherLocation,
} from "../../../src/features/weather/weather-core.ts";
import {
  DEFAULT_BACKFILL_DAYS,
  makeRetentionWindow,
  MAX_CORRECTION_DAYS,
  parseJmaRetentionDays,
  planWeatherRange,
  resolveWeatherDates,
  validateWeatherDateRequest,
  type ResolvedWeatherDates,
  type WeatherDateRange,
  type WeatherRangePlan,
  type WeatherRetentionWindow,
} from "../../../src/features/weather/update-weather-contract.ts";

const LOCATION_PROVIDER = "JMA_AMEDAS";
const MAX_LOCATION_IDS = 100;
const MAX_LOCATION_COUNT = 100;
const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const MAX_PROVIDER_RANGE_DAYS = 7;
const PROVIDER_TIMEOUT_MS = 15_000;
const SUPABASE_DB_TIMEOUT_MS = 10_000;
const MAX_RUN_DURATION_MS = 120_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SupabaseClient = ReturnType<typeof createClient>;

interface UpdateWeatherRequest {
  /** Limit a run to selected weather_locations.id values. */
  locationIds?: string[];
  /** Retry the previous target day and locations whose latest run failed. */
  retryOnly?: boolean;
  /** Force a rolling correction window (1..60 days, within JMA retention). */
  correctionDays?: number;
  /** JST run/cutoff date. Without an explicit range, targetDate is this minus one day. */
  asOfDate?: LocalDate;
  /** Inclusive observed date range. Both values are required when either is used. */
  fromDate?: LocalDate;
  toDate?: LocalDate;
  /** Make asOfDate's previous JST day the only requested date. */
  targetDateOnly?: boolean;
}

interface WeatherLocationRow extends WeatherLocation {
  id: string;
  metadata: Record<string, unknown>;
}

interface RunError {
  locationId: string;
  message: string;
}

interface LocationUpdateResult {
  locationId: string;
  imported: number;
  requestedRange: WeatherDateRange;
  effectiveRange: WeatherDateRange;
  retentionLimited: boolean;
  csvFallbackStatus: WeatherRangePlan["csvFallbackStatus"];
  seasonFailures: string[];
  errors: RunError[];
}

class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
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

function safeErrorMessage(error: unknown): string {
  let message = errorMessage(error);
  for (const name of [
    "UPDATE_WEATHER_CRON_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
  ]) {
    const value = Deno.env.get(name);
    if (value) message = message.replaceAll(value, "[redacted]");
  }
  return message.slice(0, 2_000);
}

function asRequest(value: unknown): UpdateWeatherRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError("request body must be a JSON object");
  }
  const body = value as Record<string, unknown>;
  let locationIds: string[] | undefined;
  if (body.locationIds !== undefined) {
    if (
      !Array.isArray(body.locationIds) ||
      body.locationIds.length === 0 ||
      body.locationIds.length > MAX_LOCATION_IDS
    ) {
      throw new RequestValidationError(
        `locationIds must contain 1 to ${MAX_LOCATION_IDS} values`,
      );
    }
    const normalized = body.locationIds.map((value) => {
      if (
        typeof value !== "string" ||
        value.trim().length === 0 ||
        value.length > 100 ||
        !UUID_PATTERN.test(value.trim())
      ) {
        throw new RequestValidationError(
          "locationIds must contain non-empty strings of at most 100 characters",
        );
      }
      return value.trim();
    });
    locationIds = [...new Set(normalized)];
  }

  let correctionDays: number | undefined;
  if (body.correctionDays !== undefined) {
    if (
      typeof body.correctionDays !== "number" ||
      !Number.isInteger(body.correctionDays) ||
      body.correctionDays < 1 ||
      body.correctionDays > MAX_CORRECTION_DAYS
    ) {
      throw new RequestValidationError(
        `correctionDays must be an integer from 1 to ${MAX_CORRECTION_DAYS}`,
      );
    }
    correctionDays = body.correctionDays;
  }

  if (body.retryOnly !== undefined && typeof body.retryOnly !== "boolean") {
    throw new RequestValidationError("retryOnly must be a boolean");
  }

  if (body.targetDateOnly !== undefined && typeof body.targetDateOnly !== "boolean") {
    throw new RequestValidationError("targetDateOnly must be a boolean");
  }

  let fromDate: LocalDate | undefined;
  let toDate: LocalDate | undefined;
  for (const [key, value] of [
    ["fromDate", body.fromDate],
    ["toDate", body.toDate],
  ] as const) {
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new RequestValidationError(`${key} must be an ISO date`);
    }
    const date = assertLocalDate(value, key);
    if (date < "2000-01-01" || date > "2100-12-31") {
      throw new RequestValidationError(`${key} must be between 2000-01-01 and 2100-12-31`);
    }
    if (key === "fromDate") fromDate = date;
    else toDate = date;
  }

  let asOfDate: LocalDate | undefined;
  if (body.asOfDate !== undefined) {
    if (typeof body.asOfDate !== "string") {
      throw new RequestValidationError("asOfDate must be an ISO date");
    }
    asOfDate = assertLocalDate(body.asOfDate, "asOfDate");
    if (asOfDate < "2000-01-01" || asOfDate > "2100-12-31") {
      throw new RequestValidationError("asOfDate must be between 2000-01-01 and 2100-12-31");
    }
  }

  return {
    locationIds,
    retryOnly: body.retryOnly === true,
    correctionDays,
    asOfDate,
    fromDate,
    toDate,
    targetDateOnly: body.targetDateOnly === true,
  };
}

function compactRanges(dates: readonly LocalDate[]): Array<{ from: LocalDate; to: LocalDate }> {
  if (dates.length === 0) return [];
  const sorted = [...new Set(dates)].sort();
  const ranges: Array<{ from: LocalDate; to: LocalDate }> = [];
  let from = sorted[0];
  let previous = sorted[0];
  let rangeLength = 1;
  for (const date of sorted.slice(1)) {
    if (addLocalDays(previous, 1) !== date || rangeLength >= MAX_PROVIDER_RANGE_DAYS) {
      ranges.push({ from, to: previous });
      from = date;
      rangeLength = 1;
    } else {
      rangeLength += 1;
    }
    previous = date;
  }
  ranges.push({ from, to: previous });
  return ranges;
}

function asNonEmptyString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new Error(`${label} must contain 1 to ${maxLength} characters`);
  }
  return normalized;
}

function asOptionalNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`);
  return parsed;
}

function pointFromGeometry(value: unknown): { latitude: number; longitude: number } {
  let geometry = value;
  if (typeof geometry === "string") {
    try {
      geometry = JSON.parse(geometry) as unknown;
    } catch {
      throw new Error("weather location geometry must be valid GeoJSON");
    }
  }
  if (
    geometry === null ||
    typeof geometry !== "object" ||
    Array.isArray(geometry)
  ) {
    throw new Error("weather location geometry must be a GeoJSON Point");
  }
  const record = geometry as Record<string, unknown>;
  if (record.type !== "Point" || !Array.isArray(record.coordinates) || record.coordinates.length < 2) {
    throw new Error("weather location geometry must be a GeoJSON Point");
  }
  const [longitude, latitude] = record.coordinates;
  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new Error("weather location geometry coordinates are out of range");
  }

  const crs = record.crs;
  if (crs !== undefined && crs !== null) {
    const crsName =
      typeof crs === "object" && crs !== null && !Array.isArray(crs)
        ? (crs as Record<string, unknown>).properties
        : null;
    const name =
      typeof crsName === "object" && crsName !== null && !Array.isArray(crsName)
        ? (crsName as Record<string, unknown>).name
        : null;
    const normalizedName = typeof name === "string" ? name.trim().toUpperCase() : "";
    if (!["EPSG:4326", "URN:OGC:DEF:CRS:EPSG::4326"].includes(normalizedName)) {
      throw new Error("weather location geometry must use EPSG:4326");
    }
  }

  return { latitude, longitude };
}

function locationFromRow(row: Record<string, unknown>): WeatherLocationRow {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const id = asNonEmptyString(row.id, "weather location id", 100);
  const provider = asNonEmptyString(row.provider, "weather location provider", 40);
  if (provider !== LOCATION_PROVIDER) throw new Error("weather location provider is not supported");
  const externalId = asNonEmptyString(row.external_id, "weather station id", 20);
  if (!/^\d{5}$/.test(externalId)) throw new Error("weather station id must contain five digits");
  const name = asNonEmptyString(row.name, "weather location name", 100);
  const { latitude, longitude } = pointFromGeometry(row.location);
  const elevationM = asOptionalNumber(row.elevation_m, "weather location elevation");
  if (elevationM !== null && (elevationM < -1_000 || elevationM > 10_000)) {
    throw new Error("weather location elevation is out of range");
  }
  return {
    id,
    provider: LOCATION_PROVIDER,
    externalId,
    name,
    latitude,
    longitude,
    elevationM,
    metadata,
  };
}

async function readJsonBody(request: Request): Promise<UpdateWeatherRequest> {
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_REQUEST_BODY_BYTES) {
      throw new RequestValidationError(`request body must be at most ${MAX_REQUEST_BODY_BYTES} bytes`);
    }
  }
  const rawBody = await request.text();
  if (rawBody.trim().length === 0) return {};
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new RequestValidationError("request body must use application/json");
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new RequestValidationError(`request body must be at most ${MAX_REQUEST_BODY_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    throw new RequestValidationError("request body must be valid JSON");
  }
  return asRequest(parsed);
}

async function getLocations(
  client: SupabaseClient,
  request: UpdateWeatherRequest,
): Promise<WeatherLocationRow[]> {
  let query = client
    .from("weather_locations")
    .select("id, provider, external_id, name, location, elevation_m, metadata")
    .eq("provider", LOCATION_PROVIDER)
    .eq("is_active", true)
    .limit(MAX_LOCATION_COUNT + 1);
  if (request.locationIds && request.locationIds.length > 0) {
    query = query.in("id", request.locationIds);
  }
  const { data, error } = await query;
  if (error) throw new Error(`weather location query failed: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length > MAX_LOCATION_COUNT) {
    throw new RequestValidationError(`active weather locations exceed the limit of ${MAX_LOCATION_COUNT}`);
  }
  return rows.map(locationFromRow);
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
  forceRange: boolean,
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
    (date) => forceRange || date === targetDate || !existing.has(date),
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
  const message = safeErrorMessage(error);
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
  const message = safeErrorMessage(error);
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
  dates: ResolvedWeatherDates,
  retention: WeatherRetentionWindow,
  deadline: number,
): Promise<LocationUpdateResult> {
  const assertWithinDeadline = () => {
    if (Date.now() >= deadline) throw new Error("weather update exceeded the execution time limit");
  };
  assertWithinDeadline();
  const seasonIds = await relatedSeasonIds(client, location.id);
  const defaultFrom = addLocalDays(dates.targetDate, -DEFAULT_BACKFILL_DAYS + 1);
  const metadataFromLocation = location.metadata.weather_start_date;
  const fallbackFrom =
    typeof metadataFromLocation === "string" && assertLocalDate(metadataFromLocation, "weather_start_date")
      ? metadataFromLocation
      : await earliestConfiguredDate(client, seasonIds, defaultFrom);
  const rangePlan = planWeatherRange({
    targetDate: dates.targetDate,
    seasonCount: seasonIds.length,
    seasonFallbackFrom: fallbackFrom,
    explicitRange: dates.explicitRange,
    correctionDays: request.correctionDays,
    retention,
  });
  const forceCorrection = request.correctionDays !== undefined;
  const forceExplicitRange = dates.explicitRange !== null;
  const retryTarget = request.retryOnly ? await latestFailed(client, location.id) : true;
  if (!retryTarget && !forceCorrection) {
    return {
      locationId: location.id,
      imported: 0,
      requestedRange: rangePlan.requestedRange,
      effectiveRange: rangePlan.effectiveRange,
      retentionLimited: rangePlan.retentionLimited,
      csvFallbackStatus: rangePlan.csvFallbackStatus,
      seasonFailures: [],
      errors: [],
    };
  }
  const missing = await missingDates(
    client,
    location.id,
    rangePlan.effectiveRange.from,
    rangePlan.effectiveRange.to,
    dates.targetDate,
    forceCorrection || forceExplicitRange,
  );
  const ranges = compactRanges(missing);
  if (ranges.length === 0) {
    const seasonFailures = await recalculateSeasons(client, seasonIds, dates.targetDate);
    return {
      locationId: location.id,
      imported: 0,
      requestedRange: rangePlan.requestedRange,
      effectiveRange: rangePlan.effectiveRange,
      retentionLimited: rangePlan.retentionLimited,
      csvFallbackStatus: rangePlan.csvFallbackStatus,
      seasonFailures,
      errors: seasonFailures.map((message) => ({ locationId: location.id, message })),
    };
  }

  let imported = 0;
  const errors: RunError[] = [];
  for (const range of ranges) {
    assertWithinDeadline();
    const runMetadata = {
      provider: LOCATION_PROVIDER,
      endpointKind: "JMA_AMEDAS_POINT_JSON_INTERNAL",
      timeZone: JMA_AMEDAS_TIME_ZONE,
      locationId: location.id,
      stationId: location.externalId,
      requestedFrom: rangePlan.requestedRange.from,
      requestedTo: rangePlan.requestedRange.to,
      correctionRun: forceCorrection,
      explicitRange: forceExplicitRange,
      plannedFrom: rangePlan.requestedRange.from,
      plannedTo: rangePlan.requestedRange.to,
      effectiveFrom: range.from,
      effectiveTo: range.to,
      retentionLimited: rangePlan.retentionLimited,
      csvFallbackStatus: rangePlan.csvFallbackStatus,
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
          errors.push({ locationId: location.id, message: safeErrorMessage(recordError) });
        }
      }
      await markSeasonErrors(client, seasonIds, error);
      errors.push({ locationId: location.id, message: safeErrorMessage(error) });
    }
  }

  assertWithinDeadline();
  const seasonFailures = await recalculateSeasons(client, seasonIds, dates.targetDate);
  errors.push(...seasonFailures.map((message) => ({ locationId: location.id, message })));
  if (errors.length > 0) {
    // Do not let a later successful range hide an earlier endpoint failure in
    // the season-level status. The next retry can clear ERROR once all ranges
    // complete.
    await markSeasonErrors(client, seasonIds, errors[0].message);
  }
  return {
    locationId: location.id,
    imported,
    requestedRange: rangePlan.requestedRange,
    effectiveRange: rangePlan.effectiveRange,
    retentionLimited: rangePlan.retentionLimited,
    csvFallbackStatus: rangePlan.csvFallbackStatus,
    seasonFailures,
    errors,
  };
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
  if (!projectUrl || !serviceRoleKey) {
    return json({ error: "Supabase service configuration is missing" }, 503);
  }

  try {
    const requestBody = await readJsonBody(request);
    const currentJstDate = dateInTimeZone(new Date(), JMA_AMEDAS_TIME_ZONE);
    const dates = resolveWeatherDates(requestBody, currentJstDate);
    let retention: WeatherRetentionWindow;
    try {
      const retentionSettings = parseJmaRetentionDays(
        Deno.env.get("JMA_WEATHER_RETENTION_DAYS"),
      );
      retention = makeRetentionWindow(
        addLocalDays(currentJstDate, -1),
        retentionSettings,
      );
    } catch {
      return json({ ok: false, error: "JMA retention configuration is invalid" }, 503);
    }
    validateWeatherDateRequest(dates, requestBody, retention);
    const client = createClient(projectUrl, serviceRoleKey, {
      db: { timeout: SUPABASE_DB_TIMEOUT_MS, retry: false },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const locations = await getLocations(client, requestBody);
    const provider = new JmaAmedasProvider({
      // The cache is per invocation and still protects retries/in-flight
      // duplicate URLs. The request spacing protects JMA within this run.
      minRequestIntervalMs: 250,
      pointCacheTtlMs: 1_800_000,
      stationListCacheTtlMs: 86_400_000,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
    const deadline = Date.now() + MAX_RUN_DURATION_MS;
    const results: LocationUpdateResult[] = [];
    for (const location of locations) {
      try {
        results.push(
          await processLocation(client, provider, location, requestBody, dates, retention, deadline),
        );
      } catch (error) {
        const fallbackRange =
          dates.explicitRange ?? { from: dates.targetDate, to: dates.targetDate };
        results.push({
          locationId: location.id,
          imported: 0,
          requestedRange: fallbackRange,
          effectiveRange: fallbackRange,
          retentionLimited: false,
          csvFallbackStatus: "NOT_REQUIRED",
          seasonFailures: [],
          errors: [{ locationId: location.id, message: safeErrorMessage(error) }],
        });
      }
    }
    const errors = results.flatMap((result) => result.errors);
    return json(
      {
        ok: errors.length === 0,
        provider: LOCATION_PROVIDER,
        asOfDate: dates.asOfDate,
        asOfDateMeaning:
          "JSTの実行基準日。explicit rangeがない場合、targetDateはasOfDateの前日です。",
        targetDate: dates.targetDate,
        rangeMode: dates.mode,
        requestedRange: dates.explicitRange,
        timeZone: JMA_AMEDAS_TIME_ZONE,
        retentionWindow: {
          days: retention.days,
          earliestDate: retention.earliestDate,
          latestDate: retention.latestDate,
          basis: retention.basis,
        },
        locationCount: locations.length,
        importedRecordCount: results.reduce((sum, result) => sum + result.imported, 0),
        results,
        errors,
      },
      errors.length === 0 ? 200 : 207,
    );
  } catch (error) {
    if (error instanceof RequestValidationError || error instanceof RangeError) {
      return json({ ok: false, error: safeErrorMessage(error) }, 400);
    }
    return json({ ok: false, error: "weather update failed" }, 500);
  }
}

Deno.serve(handleUpdateWeather);
