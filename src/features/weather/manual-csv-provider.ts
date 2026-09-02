import {
  addLocalDays,
  assertLocalDate,
  compareLocalDates,
  type DailyWeatherValue,
  type GeoPoint,
  type LocalDate,
  type WeatherLocation,
  type WeatherProvider,
} from "./weather-core";

export interface ManualCsvParseOptions {
  sourceName?: string;
  importedAt?: string;
  location?: WeatherLocation;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field.trim());
  return fields;
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let line = "";
  let quoted = false;
  const lines: string[] = [];
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      quoted = !quoted;
      line += character;
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      lines.push(line);
      line = "";
    } else {
      line += character;
    }
  }
  if (line.length > 0) lines.push(line);
  for (const rawLine of lines) {
    if (rawLine.trim().length === 0) continue;
    rows.push(splitCsvLine(rawLine));
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_()-]/g, "");
}

function findColumn(header: readonly string[], candidates: readonly string[]): number {
  const normalized = header.map(normalizeHeader);
  for (const candidate of candidates) {
    const index = normalized.indexOf(normalizeHeader(candidate));
    if (index >= 0) return index;
  }
  return -1;
}

function parseDate(value: string): LocalDate | null {
  const text = value.trim();
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  const japanese = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
  const match = iso ?? japanese;
  if (!match) return null;
  const date = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? (assertLocalDate(date), date) : null;
}

function parseTemperature(value: string | undefined): number | null {
  if (value == null) return null;
  const text = value.trim();
  if (text === "" || text === "-" || text === "///" || text === "//") return null;
  const number = Number(text.replace(/[℃°]/g, "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function qualityCode(value: number | null, rawQuality: string | undefined): DailyWeatherValue["qualityCode"] {
  if (value === null) return "MISSING";
  const quality = rawQuality?.trim().toLowerCase();
  if (!quality || quality === "0" || quality === "正常" || quality === "normal") {
    return "COMPLETE";
  }
  return "ESTIMATED";
}

/**
 * Parse a deliberately small, operator-reviewed daily CSV format. The first
 * row containing a date/mean header is used, so explanatory JMA CSV preamble
 * lines are harmless. Headers may be English (`date,mean_temp_c`) or common
 * JMA labels (`年月日,平均気温(℃)`).
 */
export function parseManualDailyWeatherCsv(
  csv: string,
  options: ManualCsvParseOptions = {},
): DailyWeatherValue[] {
  if (typeof csv !== "string" || csv.trim().length === 0) {
    throw new RangeError("weather CSV must not be empty");
  }
  const rows = parseCsvRows(csv);
  const headerRowIndex = rows.findIndex((row) => {
    const dateColumn = findColumn(row, ["date", "observed_date", "年月日", "日付"]);
    const meanColumn = findColumn(row, [
      "mean_temp_c",
      "meanTempC",
      "mean temperature",
      "平均気温",
      "平均気温(℃)",
    ]);
    return dateColumn >= 0 && meanColumn >= 0;
  });
  if (headerRowIndex < 0) {
    throw new RangeError("weather CSV requires date and mean temperature columns");
  }
  const header = rows[headerRowIndex];
  const dateColumn = findColumn(header, ["date", "observed_date", "年月日", "日付"]);
  const meanColumn = findColumn(header, [
    "mean_temp_c",
    "meanTempC",
    "mean temperature",
    "平均気温",
    "平均気温(℃)",
  ]);
  const maxColumn = findColumn(header, ["max_temp_c", "maxTempC", "最高気温", "最高気温(℃)"]);
  const minColumn = findColumn(header, ["min_temp_c", "minTempC", "最低気温", "最低気温(℃)"]);
  const qualityColumn = findColumn(header, ["quality_code", "quality", "品質情報", "品質"]);
  const importedAt = options.importedAt ?? new Date().toISOString();
  const sourceName = options.sourceName ?? "manual-csv";
  const values: DailyWeatherValue[] = [];
  const seen = new Set<LocalDate>();
  for (const row of rows.slice(headerRowIndex + 1)) {
    const date = parseDate(row[dateColumn] ?? "");
    if (date === null || seen.has(date)) continue;
    seen.add(date);
    const meanTempC = parseTemperature(row[meanColumn]);
    const maxTempC = parseTemperature(maxColumn >= 0 ? row[maxColumn] : undefined);
    const minTempC = parseTemperature(minColumn >= 0 ? row[minColumn] : undefined);
    const rawQuality = qualityColumn >= 0 ? row[qualityColumn] : undefined;
    values.push({
      observedDate: date,
      date,
      meanTempC,
      maxTempC,
      minTempC,
      sampleCount: meanTempC === null ? 0 : 1,
      expectedSampleCount: 1,
      observationCount: meanTempC === null ? 0 : 1,
      qualityFlags: rawQuality == null || rawQuality === "" ? [] : [rawQuality],
      qualityCode: qualityCode(meanTempC, rawQuality),
      providerRevision: "manual-csv-v1",
      sourceMetadata: {
        provider: "MANUAL_CSV",
        sourceName,
        importedAt,
        rawQuality: rawQuality ?? null,
        timeZone: "Asia/Tokyo",
      },
    });
  }
  return values.sort((a, b) => compareLocalDates(a.observedDate, b.observedDate));
}

export interface ManualCsvWeatherProviderOptions {
  location: WeatherLocation;
  values: readonly DailyWeatherValue[];
}

/** Provider implementation for reviewed operator CSVs and deterministic fixtures. */
export class ManualCsvWeatherProvider implements WeatherProvider {
  private readonly location: WeatherLocation;
  private readonly byDate: Map<LocalDate, DailyWeatherValue>;

  constructor(options: ManualCsvWeatherProviderOptions) {
    this.location = options.location;
    this.byDate = new Map(options.values.map((value) => [value.observedDate, value]));
  }

  static fromCsv(
    location: WeatherLocation,
    csv: string,
    options: Omit<ManualCsvParseOptions, "location"> = {},
  ): ManualCsvWeatherProvider {
    return new ManualCsvWeatherProvider({
      location,
      values: parseManualDailyWeatherCsv(csv, { ...options, location }),
    });
  }

  async findNearestLocations(_point: GeoPoint, limit = 5): Promise<WeatherLocation[]> {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be positive");
    return [{ ...this.location, distanceM: 0 }].slice(0, limit);
  }

  async fetchDaily(from: LocalDate, to: LocalDate): Promise<DailyWeatherValue[]>;
  async fetchDaily(
    _location: WeatherLocation,
    from: LocalDate,
    to: LocalDate,
  ): Promise<DailyWeatherValue[]>;
  async fetchDaily(
    locationOrFrom: WeatherLocation | LocalDate,
    fromOrTo: LocalDate,
    maybeTo?: LocalDate,
  ): Promise<DailyWeatherValue[]> {
    const from = typeof locationOrFrom === "string" ? locationOrFrom : fromOrTo;
    const to = typeof locationOrFrom === "string" ? fromOrTo : maybeTo;
    if (to === undefined) throw new RangeError("to date is required");
    assertLocalDate(from, "from");
    assertLocalDate(to, "to");
    if (compareLocalDates(from, to) > 0) return [];
    const values: DailyWeatherValue[] = [];
    for (const date of dateRange(from, to)) {
      values.push(
        this.byDate.get(date) ?? {
          observedDate: date,
          date,
          meanTempC: null,
          maxTempC: null,
          minTempC: null,
          sampleCount: 0,
          expectedSampleCount: 1,
          observationCount: 0,
          qualityFlags: [],
          qualityCode: "MISSING",
          providerRevision: "manual-csv-v1",
          sourceMetadata: {
            provider: "MANUAL_CSV",
            sourceName: "manual-csv",
            timeZone: "Asia/Tokyo",
            missingFromImport: true,
          },
        },
      );
    }
    return values;
  }
}

function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const result: LocalDate[] = [];
  let cursor = from;
  while (cursor <= to) {
    result.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return result;
}

/** Alias used by tests and the documented fixture fallback. */
export const FixtureWeatherProvider = ManualCsvWeatherProvider;
export const parseWeatherCsv = parseManualDailyWeatherCsv;
export const parseManualDailyCsv = parseManualDailyWeatherCsv;
