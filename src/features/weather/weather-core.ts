/**
 * Weather provider boundary and the provider-independent parts of the JMA
 * adapter.
 *
 * This module intentionally has no Node, Next.js, or Supabase dependency. It
 * can therefore be imported by both Vitest and a Supabase Edge Function. JMA
 * timestamps are calendar values in Asia/Tokyo; they are never converted to a
 * host-local Date while calculating an observed date.
 */

export type LocalDate = string;

export type WeatherProviderId = "JMA_AMEDAS" | "WAGRI_GRID" | (string & {});

export type WeatherQualityCode =
  | "COMPLETE"
  | "ESTIMATED"
  | "MISSING"
  | "INVALID";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface WeatherLocation {
  id?: string;
  provider: WeatherProviderId;
  externalId: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationM?: number | null;
  distanceM?: number;
  metadata?: Record<string, unknown>;
}

export interface DailyWeatherValue {
  observedDate: LocalDate;
  /** Alias useful to callers that use the domain's daily observation shape. */
  date: LocalDate;
  meanTempC: number | null;
  maxTempC: number | null;
  minTempC: number | null;
  /** Number of valid hourly values used for the mean (0..24). */
  sampleCount: number;
  /** JMA-style daily mean target. This is 24 for the MVP adapter. */
  expectedSampleCount: number;
  /** Number of distinct JMA timestamps received, including missing temp rows. */
  observationCount: number;
  /** Raw JMA quality flags for the distinct timestamps used/received. */
  qualityFlags: readonly (number | string | null)[];
  qualityCode: WeatherQualityCode;
  providerRevision?: string | null;
  sourceMetadata: Record<string, unknown>;
}

export interface WeatherProvider {
  /** Return candidate locations ordered from nearest to farthest. */
  findNearestLocations(
    point: GeoPoint,
    limit?: number,
  ): Promise<WeatherLocation[]>;
  /** Fetch one value for every calendar date in the inclusive range. */
  fetchDaily(
    location: WeatherLocation,
    from: LocalDate,
    to: LocalDate,
  ): Promise<DailyWeatherValue[]>;
}

export const JMA_AMEDAS_STATION_LIST_URL =
  "https://www.jma.go.jp/bosai/amedas/const/amedastable.json";
export const JMA_AMEDAS_POINT_URL_BASE =
  "https://www.jma.go.jp/bosai/amedas/data/point";
export const JMA_AMEDAS_PROVIDER_REVISION = "amedas-point-json-v1";
export const JMA_AMEDAS_TIME_ZONE = "Asia/Tokyo";
export const JMA_AMEDAS_HOURS = [0, 3, 6, 9, 12, 15, 18, 21] as const;
export const JMA_DAILY_EXPECTED_SAMPLE_COUNT = 24;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const JMA_TIMESTAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string") return false;
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function assertLocalDate(value: string, name = "date"): LocalDate {
  if (!isLocalDate(value)) {
    throw new RangeError(`${name} must be a valid ISO date (YYYY-MM-DD)`);
  }
  return value;
}

function parseDateAtUtcMidnight(value: LocalDate): Date {
  assertLocalDate(value);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function formatDateAtUtcMidnight(value: Date): LocalDate {
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return assertLocalDate(`${year}-${month}-${day}`);
}

export function addLocalDays(value: LocalDate, days: number): LocalDate {
  assertLocalDate(value);
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  const date = parseDateAtUtcMidnight(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateAtUtcMidnight(date);
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  assertLocalDate(a, "a");
  assertLocalDate(b, "b");
  return a < b ? -1 : a > b ? 1 : 0;
}

export function listLocalDates(from: LocalDate, to: LocalDate): LocalDate[] {
  assertLocalDate(from, "from");
  assertLocalDate(to, "to");
  if (compareLocalDates(from, to) > 0) return [];
  const dates: LocalDate[] = [];
  let cursor = from;
  while (compareLocalDates(cursor, to) <= 0) {
    dates.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return dates;
}

export function maxLocalDate(values: readonly (LocalDate | null | undefined)[]): LocalDate | null {
  let maximum: LocalDate | null = null;
  for (const value of values) {
    if (value == null) continue;
    assertLocalDate(value);
    if (maximum === null || value > maximum) maximum = value;
  }
  return maximum;
}

export function differenceInLocalDays(from: LocalDate, to: LocalDate): number {
  return Math.round(
    (parseDateAtUtcMidnight(to).getTime() - parseDateAtUtcMidnight(from).getTime()) /
      MILLISECONDS_PER_DAY,
  );
}

/** Format an instant as a LocalDate in the named IANA time zone. */
export function dateInTimeZone(
  value: Date = new Date(),
  timeZone = JMA_AMEDAS_TIME_ZONE,
): LocalDate {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError("value must be a valid Date");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string): string => {
    const part = parts.find((entry) => entry.type === type)?.value;
    if (part === undefined) throw new RangeError(`missing ${type} date part`);
    return part;
  };
  return assertLocalDate(`${get("year")}-${get("month")}-${get("day")}`);
}

export interface JmaAmedasRecord {
  temp?: unknown;
  [key: string]: unknown;
}

export interface JmaAmedasSample {
  timestamp: string;
  observedDate: LocalDate;
  hour: number;
  minute: number;
  second: number;
  tempC: number | null;
  qualityFlag: number | string | null;
  source: JmaAmedasRecord;
}

export interface AggregatedJmaDailyValue extends DailyWeatherValue {
  duplicateTimestampCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJmaTemperature(value: unknown): {
  tempC: number | null;
  qualityFlag: number | string | null;
} {
  if (Array.isArray(value)) {
    const temperature = value[0];
    const quality = value[1];
    return {
      tempC:
        typeof temperature === "number" && Number.isFinite(temperature)
          ? temperature
          : null,
      qualityFlag:
        typeof quality === "number" || typeof quality === "string" ? quality : null,
    };
  }
  return {
    tempC: typeof value === "number" && Number.isFinite(value) ? value : null,
    qualityFlag: null,
  };
}

/** Parse a JMA YYYYMMDDHHmmss key as a local calendar timestamp. */
export function parseJmaTimestamp(timestamp: string): {
  observedDate: LocalDate;
  hour: number;
  minute: number;
  second: number;
} | null {
  const match = JMA_TIMESTAMP_PATTERN.exec(timestamp);
  if (!match) return null;
  const observedDate = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isLocalDate(observedDate)) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { observedDate, hour, minute, second };
}

/**
 * Convert the object returned by a point JSON endpoint into timestamped
 * samples. Unknown fields are preserved on each sample's source object so a
 * later importer can retain additional JMA elements without changing this
 * parser.
 */
export function parseJmaPointPayload(payload: unknown): JmaAmedasSample[] {
  const entries: Array<[string, unknown]> = [];
  if (Array.isArray(payload)) {
    // This shape is only for fixtures/manual adapters. The real endpoint is
    // an object keyed by YYYYMMDDHHmmss.
    for (const item of payload) {
      if (!isRecord(item) || typeof item.timestamp !== "string") continue;
      entries.push([item.timestamp, item]);
    }
  } else if (isRecord(payload)) {
    for (const [timestamp, record] of Object.entries(payload)) entries.push([timestamp, record]);
  }

  const samples: JmaAmedasSample[] = [];
  for (const [timestamp, rawRecord] of entries) {
    const parsed = parseJmaTimestamp(timestamp);
    if (!parsed || !isRecord(rawRecord)) continue;
    const record = rawRecord as JmaAmedasRecord;
    const temperature = parseJmaTemperature(record.temp);
    samples.push({
      timestamp,
      ...parsed,
      tempC: temperature.tempC,
      qualityFlag: temperature.qualityFlag,
      source: record,
    });
  }
  return samples;
}

function hasNormalQualityFlag(value: number | string | null): boolean {
  return value === 0 || value === "0" || value === "正常" || value === "normal";
}

/**
 * Derive a daily value from JMA's ten-minute samples. One value per local
 * hour is selected, preferring minute 00. When minute 00 is absent, the
 * nearest valid sample in that hour is used and the day is marked ESTIMATED.
 * A day with no valid temperature is MISSING; no missing value is changed to
 * zero.
 */
export function aggregateJmaDaily(
  samples: readonly JmaAmedasSample[],
  observedDate: LocalDate,
): AggregatedJmaDailyValue {
  assertLocalDate(observedDate, "observedDate");
  const byTimestamp = new Map<string, JmaAmedasSample>();
  let duplicateTimestampCount = 0;
  for (const sample of samples) {
    if (sample.observedDate !== observedDate) continue;
    if (byTimestamp.has(sample.timestamp)) duplicateTimestampCount += 1;
    byTimestamp.set(sample.timestamp, sample);
  }
  const uniqueSamples = [...byTimestamp.values()].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );
  const validSamples = uniqueSamples.filter(
    (sample) => typeof sample.tempC === "number" && Number.isFinite(sample.tempC),
  );
  const qualityFlags = uniqueSamples.map((sample) => sample.qualityFlag);

  const selected: JmaAmedasSample[] = [];
  let usedFallbackHour = false;
  for (let hour = 0; hour < 24; hour += 1) {
    const hourSamples = validSamples.filter((sample) => sample.hour === hour);
    if (hourSamples.length === 0) continue;
    const exact = hourSamples.find((sample) => sample.minute === 0);
    if (exact) {
      selected.push(exact);
      continue;
    }
    usedFallbackHour = true;
    const nearest = [...hourSamples].sort((a, b) => {
      const minuteOrder = Math.abs(a.minute - 0) - Math.abs(b.minute - 0);
      return minuteOrder !== 0 ? minuteOrder : a.timestamp.localeCompare(b.timestamp);
    })[0];
    if (nearest) selected.push(nearest);
  }

  const selectedValues = selected
    .map((sample) => sample.tempC)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const meanTempC =
    selectedValues.length > 0
      ? selectedValues.reduce((sum, value) => sum + value, 0) / selectedValues.length
      : null;
  const allValues = validSamples
    .map((sample) => sample.tempC)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minTempC = allValues.length > 0 ? Math.min(...allValues) : null;
  const maxTempC = allValues.length > 0 ? Math.max(...allValues) : null;
  const selectedFlagsNormal = selected.every((sample) => hasNormalQualityFlag(sample.qualityFlag));
  const qualityCode: WeatherQualityCode =
    selected.length === 0
      ? "MISSING"
      : selected.length === JMA_DAILY_EXPECTED_SAMPLE_COUNT &&
          !usedFallbackHour &&
          selectedFlagsNormal
        ? "COMPLETE"
        : "ESTIMATED";

  return {
    observedDate,
    date: observedDate,
    meanTempC,
    minTempC,
    maxTempC,
    sampleCount: selected.length,
    expectedSampleCount: JMA_DAILY_EXPECTED_SAMPLE_COUNT,
    observationCount: uniqueSamples.length,
    qualityFlags,
    qualityCode,
    providerRevision: JMA_AMEDAS_PROVIDER_REVISION,
    sourceMetadata: {
      timeZone: JMA_AMEDAS_TIME_ZONE,
      aggregation: "one-valid-sample-per-local-hour-prefer-minute-00",
      expectedHourlySamples: JMA_DAILY_EXPECTED_SAMPLE_COUNT,
      observedTimestampCount: uniqueSamples.length,
      validTemperatureTimestampCount: validSamples.length,
      duplicateTimestampCount,
      fallbackHourUsed: usedFallbackHour,
    },
    duplicateTimestampCount,
  };
}

function stationCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!Array.isArray(value) || value.length < 2) return null;
  const degrees = Number(value[0]);
  const minutes = Number(value[1]);
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return null;
  return degrees + minutes / 60;
}

export interface JmaStationMetadata {
  type?: string;
  elems?: string;
  lat?: unknown;
  lon?: unknown;
  alt?: unknown;
  kjName?: unknown;
  knName?: unknown;
  enName?: unknown;
  [key: string]: unknown;
}

/** Convert the JMA station-list object into provider-neutral locations. */
export function parseJmaStationList(payload: unknown): WeatherLocation[] {
  if (!isRecord(payload)) return [];
  const locations: WeatherLocation[] = [];
  for (const [externalId, raw] of Object.entries(payload)) {
    if (!/^\d{5}$/.test(externalId) || !isRecord(raw)) continue;
    const metadata = raw as JmaStationMetadata;
    const latitude = stationCoordinate(metadata.lat);
    const longitude = stationCoordinate(metadata.lon);
    if (latitude === null || longitude === null) continue;
    // The first element flag identifies stations that publish temperature in
    // amedastable.json's elems string. Keep unknown values for fixtures, but
    // skip stations explicitly marked as not measuring temperature.
    if (typeof metadata.elems === "string" && metadata.elems.length > 0 && metadata.elems[0] !== "1") {
      continue;
    }
    const name =
      typeof metadata.kjName === "string" && metadata.kjName.length > 0
        ? metadata.kjName
        : externalId;
    const elevationM =
      typeof metadata.alt === "number" && Number.isFinite(metadata.alt) ? metadata.alt : null;
    locations.push({
      provider: "JMA_AMEDAS",
      externalId,
      name,
      latitude,
      longitude,
      elevationM,
      metadata: { ...metadata },
    });
  }
  return locations;
}

function validateGeoPoint(point: GeoPoint): GeoPoint {
  if (
    !point ||
    typeof point.latitude !== "number" ||
    typeof point.longitude !== "number" ||
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    point.longitude < -180 ||
    point.longitude > 180
  ) {
    throw new RangeError("point must contain finite latitude/longitude values");
  }
  return point;
}

/** Haversine distance in metres, used only for nearest-station ranking. */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  validateGeoPoint(a);
  validateGeoPoint(b);
  const radius = 6_371_000;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface WeatherResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type WeatherFetcher = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<WeatherResponseLike>;

export interface JmaAmedasProviderOptions {
  fetcher?: WeatherFetcher;
  stationListUrl?: string;
  pointUrlBase?: string;
  /** Station-list cache lifetime. Defaults to one day. */
  stationListCacheTtlMs?: number;
  /** Point JSON cache lifetime. Defaults to 30 minutes. */
  pointCacheTtlMs?: number;
  /** Minimum gap between network requests. Defaults to 250 ms. */
  minRequestIntervalMs?: number;
  /** Abort slow upstream calls. Defaults to 20 seconds. */
  timeoutMs?: number;
  now?: () => number;
}

interface CacheEntry {
  fetchedAt: number;
  payload: unknown;
}

function defaultFetcher(url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response> {
  return fetch(url, init);
}

function sleep(milliseconds: number): Promise<void> {
  return milliseconds <= 0
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * JMA AMeDAS adapter. The endpoint is the same low-volume JSON consumed by
 * the JMA website. It is intentionally cached and sequential: this adapter
 * must not be used as a high-frequency or bulk scraper.
 */
export class JmaAmedasProvider implements WeatherProvider {
  private readonly fetcher: WeatherFetcher;
  private readonly stationListUrl: string;
  private readonly pointUrlBase: string;
  private readonly stationListCacheTtlMs: number;
  private readonly pointCacheTtlMs: number;
  private readonly minRequestIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private lastRequestAt = 0;
  private stationList: WeatherLocation[] | null = null;
  private stationListFetchedAt = 0;

  constructor(options: JmaAmedasProviderOptions = {}) {
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.stationListUrl = options.stationListUrl ?? JMA_AMEDAS_STATION_LIST_URL;
    this.pointUrlBase = (options.pointUrlBase ?? JMA_AMEDAS_POINT_URL_BASE).replace(/\/$/, "");
    this.stationListCacheTtlMs = options.stationListCacheTtlMs ?? 86_400_000;
    this.pointCacheTtlMs = options.pointCacheTtlMs ?? 1_800_000;
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? 250;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.now = options.now ?? (() => Date.now());
  }

  async listLocations(): Promise<WeatherLocation[]> {
    const now = this.now();
    if (this.stationList && now - this.stationListFetchedAt < this.stationListCacheTtlMs) {
      return this.stationList.map((location) => ({ ...location, metadata: { ...location.metadata } }));
    }
    const payload = await this.requestJson(this.stationListUrl, this.stationListCacheTtlMs);
    const parsed = parseJmaStationList(payload);
    if (parsed.length === 0) throw new Error("JMA station list contained no temperature stations");
    this.stationList = parsed;
    this.stationListFetchedAt = this.now();
    return parsed.map((location) => ({ ...location, metadata: { ...location.metadata } }));
  }

  async findNearestLocations(point: GeoPoint, limit = 5): Promise<WeatherLocation[]> {
    validateGeoPoint(point);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("limit must be an integer from 1 to 100");
    }
    const locations = await this.listLocations();
    return locations
      .map((location) => ({
        ...location,
        distanceM: distanceMetres(point, {
          latitude: location.latitude,
          longitude: location.longitude,
        }),
      }))
      .sort((a, b) => {
        const distanceOrder = (a.distanceM ?? 0) - (b.distanceM ?? 0);
        return distanceOrder !== 0 ? distanceOrder : a.externalId.localeCompare(b.externalId);
      })
      .slice(0, limit);
  }

  private pointUrl(stationId: string, date: LocalDate, hour: number): string {
    if (!/^\d{5}$/.test(stationId)) throw new RangeError("JMA station id must contain five digits");
    assertLocalDate(date);
    const compactDate = date.replaceAll("-", "");
    const compactHour = String(hour).padStart(2, "0");
    return `${this.pointUrlBase}/${stationId}/${compactDate}_${compactHour}.json`;
  }

  private async requestJson(url: string, ttlMs: number): Promise<unknown> {
    const now = this.now();
    const cached = this.cache.get(url);
    if (cached && now - cached.fetchedAt < ttlMs) return cached.payload;
    const pending = this.inFlight.get(url);
    if (pending) return pending;
    const request = this.requestJsonUncached(url);
    this.inFlight.set(url, request);
    try {
      const payload = await request;
      this.cache.set(url, { fetchedAt: this.now(), payload });
      return payload;
    } finally {
      this.inFlight.delete(url);
    }
  }

  private async requestJsonUncached(url: string): Promise<unknown> {
    const waitMs = this.minRequestIntervalMs - (this.now() - this.lastRequestAt);
    await sleep(Math.max(0, waitMs));
    this.lastRequestAt = this.now();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null;
    try {
      const response = await this.fetcher(url, {
        headers: { Accept: "application/json" },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) throw new Error(`JMA request failed (${response.status}) for ${url}`);
      return await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`JMA JSON unavailable: ${message}`);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }

  async fetchDaily(
    location: WeatherLocation,
    from: LocalDate,
    to: LocalDate,
  ): Promise<DailyWeatherValue[]> {
    assertLocalDate(from, "from");
    assertLocalDate(to, "to");
    if (compareLocalDates(from, to) > 0) return [];
    const stationId = location.externalId;
    if (!/^\d{5}$/.test(stationId)) throw new RangeError("JMA station id must contain five digits");

    const results: DailyWeatherValue[] = [];
    for (const date of listLocalDates(from, to)) {
      const allSamples: JmaAmedasSample[] = [];
      const sourceUrls: string[] = [];
      for (const hour of JMA_AMEDAS_HOURS) {
        const url = this.pointUrl(stationId, date, hour);
        const payload = await this.requestJson(url, this.pointCacheTtlMs);
        allSamples.push(...parseJmaPointPayload(payload));
        sourceUrls.push(url);
      }
      const aggregated = aggregateJmaDaily(allSamples, date);
      results.push({
        ...aggregated,
        providerRevision: JMA_AMEDAS_PROVIDER_REVISION,
        sourceMetadata: {
          ...aggregated.sourceMetadata,
          provider: "JMA_AMEDAS",
          endpointKind: "JMA_AMEDAS_POINT_JSON_INTERNAL",
          stationId,
          stationName: location.name,
          sourceUrls,
          fetchedAt: new Date(this.now()).toISOString(),
        },
      });
    }
    return results;
  }
}

export interface SeasonRuleLike {
  harvestStartTempC?: number;
  harvest_start_temp_c?: number;
  harvestTargetTempC?: number;
  harvest_target_temp_c?: number;
  harvestEndTempC?: number;
  harvest_end_temp_c?: number;
  accumulationStartOffsetDays?: number;
  accumulation_start_offset_days?: number;
}

export interface SeasonWeatherSummaryInput {
  headingDate?: LocalDate | null;
  heading_date?: LocalDate | null;
  harvestDate?: LocalDate | null;
  harvest_date?: LocalDate | null;
  weatherLocationId?: string | null;
  weather_location_id?: string | null;
  rule?: SeasonRuleLike | null;
  observations: readonly Pick<DailyWeatherValue, "observedDate" | "meanTempC">[];
  asOfDate: LocalDate;
  error?: unknown;
}

export interface SeasonWeatherSummary {
  accumulatedTempC: number;
  accumulatedThrough: LocalDate | null;
  validDayCount: number;
  missingDayCount: number;
  maturityStatus:
    | "NOT_CONFIGURED"
    | "BEFORE_HEADING"
    | "GROWING"
    | "GROWING_LATE"
    | "HARVEST_SOON"
    | "HARVEST_READY"
    | "OVERDUE"
    | "HARVESTED";
  dataStatus: "PENDING" | "COMPLETE" | "INCOMPLETE" | "STALE" | "ERROR";
  estimatedDaysToStart: number | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Recalculate a season from daily rows. The Edge Function uses this function
 * after each UPSERT, while its deterministic behavior is covered by Node
 * fixture tests. Missing rows/means contribute to missingDayCount, never to
 * the accumulated sum.
 */
export function calculateSeasonWeatherSummary(
  input: SeasonWeatherSummaryInput,
): SeasonWeatherSummary {
  const headingDate = input.headingDate ?? input.heading_date ?? null;
  const harvestDate = input.harvestDate ?? input.harvest_date ?? null;
  const locationId = input.weatherLocationId ?? input.weather_location_id ?? null;
  const rule = input.rule ?? null;
  assertLocalDate(input.asOfDate, "asOfDate");
  if (headingDate !== null) assertLocalDate(headingDate, "headingDate");
  if (harvestDate !== null) assertLocalDate(harvestDate, "harvestDate");

  const startThreshold = finiteNumber(rule?.harvestStartTempC ?? rule?.harvest_start_temp_c);
  const targetThreshold = finiteNumber(rule?.harvestTargetTempC ?? rule?.harvest_target_temp_c);
  const endThreshold = finiteNumber(rule?.harvestEndTempC ?? rule?.harvest_end_temp_c);
  const offset = finiteNumber(
    rule?.accumulationStartOffsetDays ?? rule?.accumulation_start_offset_days,
  );
  const configured =
    headingDate !== null &&
    locationId !== null &&
    startThreshold !== null &&
    targetThreshold !== null &&
    endThreshold !== null &&
    offset !== null &&
    Number.isInteger(offset) &&
    offset >= 0 &&
    offset <= 7;
  if (!configured) {
    return {
      accumulatedTempC: 0,
      accumulatedThrough: null,
      validDayCount: 0,
      missingDayCount: 0,
      maturityStatus: harvestDate !== null ? "HARVESTED" : "NOT_CONFIGURED",
      dataStatus: input.error ? "ERROR" : "PENDING",
      estimatedDaysToStart: null,
    };
  }

  const accumulationStartDate = addLocalDays(headingDate!, offset!);
  const byDate = new Map<LocalDate, number | null>();
  for (const observation of input.observations) {
    if (!isLocalDate(observation.observedDate)) continue;
    if (observation.observedDate > input.asOfDate) continue;
    byDate.set(observation.observedDate, finiteNumber(observation.meanTempC));
  }
  const accumulatedThrough = maxLocalDate([...byDate.keys()]);
  const throughDate = accumulatedThrough;
  let accumulatedTempC = 0;
  let validDayCount = 0;
  let missingDayCount = 0;
  if (throughDate !== null && throughDate >= accumulationStartDate) {
    for (const date of listLocalDates(accumulationStartDate, throughDate)) {
      const value = byDate.get(date);
      if (value !== undefined && value !== null) {
        accumulatedTempC += value;
        validDayCount += 1;
      } else {
        missingDayCount += 1;
      }
    }
  }

  const latestValidDate = maxLocalDate(
    [...byDate.entries()]
      .filter(([, value]) => value !== null)
      .map(([date]) => date),
  );
  const stale =
    latestValidDate !== null && differenceInLocalDays(latestValidDate, input.asOfDate) >= 2;
  const dataStatus: SeasonWeatherSummary["dataStatus"] = input.error
    ? "ERROR"
    : throughDate === null || (throughDate >= accumulationStartDate && latestValidDate === null)
      ? "PENDING"
      : stale
        ? "STALE"
        : missingDayCount > 0
          ? "INCOMPLETE"
          : "COMPLETE";

  let maturityStatus: SeasonWeatherSummary["maturityStatus"];
  if (harvestDate !== null) {
    maturityStatus = "HARVESTED";
  } else if (input.asOfDate < accumulationStartDate) {
    maturityStatus = "BEFORE_HEADING";
  } else if (startThreshold! <= 0) {
    maturityStatus = accumulatedTempC <= endThreshold! ? "HARVEST_READY" : "OVERDUE";
  } else {
    const ratio = accumulatedTempC / startThreshold!;
    maturityStatus =
      ratio < 0.7
        ? "GROWING"
        : ratio < 0.9
          ? "GROWING_LATE"
          : accumulatedTempC < startThreshold!
            ? "HARVEST_SOON"
            : accumulatedTempC <= endThreshold!
              ? "HARVEST_READY"
              : "OVERDUE";
  }

  const recentValues = [...byDate.entries()]
    .filter(
      ([date, value]) =>
        value !== null &&
        value !== undefined &&
        differenceInLocalDays(date, input.asOfDate) >= 0 &&
        differenceInLocalDays(date, input.asOfDate) <= 6,
    )
    .map(([, value]) => value as number);
  const recentAverage =
    recentValues.length > 0
      ? recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length
      : null;
  const estimatedDaysToStart =
    recentValues.length >= 5 && recentAverage !== null && recentAverage > 0
      ? Math.max(0, Math.ceil((startThreshold! - accumulatedTempC) / recentAverage))
      : null;

  return {
    accumulatedTempC,
    accumulatedThrough: throughDate,
    validDayCount,
    missingDayCount,
    maturityStatus,
    dataStatus,
    estimatedDaysToStart,
  };
}
