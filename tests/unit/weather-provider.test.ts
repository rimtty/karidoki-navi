import { describe, expect, it } from "vitest";
import fullHourlyFixture from "../fixtures/weather/jma-point-hourly.json";
import missingFixture from "../fixtures/weather/jma-point-missing.json";
import {
  JmaAmedasProvider,
  aggregateJmaDaily,
  calculateSeasonWeatherSummary,
  parseJmaPointPayload,
  parseJmaStationList,
} from "../../src/features/weather";
import {
  ManualCsvWeatherProvider,
  parseManualDailyWeatherCsv,
} from "../../src/features/weather/manual-csv-provider";

describe("JMA AMeDAS weather core", () => {
  it("computes a 24-hour mean and keeps JST calendar dates", () => {
    const samples = parseJmaPointPayload(fullHourlyFixture);
    const value = aggregateJmaDaily(samples, "2026-08-01");

    expect(value.sampleCount).toBe(24);
    expect(value.expectedSampleCount).toBe(24);
    expect(value.meanTempC).toBeCloseTo(24.6, 8);
    expect(value.qualityCode).toBe("COMPLETE");
    expect(value.minTempC).toBe(20);
    expect(value.maxTempC).toBe(29.2);
  });

  it("marks missing hourly values estimated and never turns them into zero", () => {
    const samples = parseJmaPointPayload(missingFixture);
    const value = aggregateJmaDaily(samples, "2026-08-02");

    expect(value.meanTempC).not.toBe(0);
    expect(value.meanTempC).toBeCloseTo((21 + 21.5 + 22 + 22.5 + 25 + 25.5 + 24) / 7, 8);
    expect(value.sampleCount).toBe(7);
    expect(value.qualityCode).toBe("ESTIMATED");
    expect(value.sourceMetadata.fallbackHourUsed).toBe(false);
  });

  it("removes duplicate timestamps deterministically", () => {
    const samples = parseJmaPointPayload([
      { timestamp: "2026-08-03T00:00:00", temp: [20, 0] },
      { timestamp: "20260803000000", temp: [21, 0] },
    ]);
    // The non-JMA ISO timestamp is ignored, leaving one timestamp here.
    expect(samples).toHaveLength(1);
    const value = aggregateJmaDaily(
      [...samples, { ...samples[0], tempC: 22 }],
      "2026-08-03",
    );
    expect(value.duplicateTimestampCount).toBe(1);
    expect(value.meanTempC).toBe(22);
  });

  it("parses JMA station coordinates and retains station metadata", () => {
    const stations = parseJmaStationList({
      "67316": {
        type: "C",
        elems: "11112010",
        lat: [34, 35],
        lon: [133, 3],
        alt: 350,
        kjName: "世羅",
      },
      "99999": {
        elems: "01111111",
        lat: [34, 0],
        lon: [133, 0],
        kjName: "気温なし",
      },
    });
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({
      externalId: "67316",
      name: "世羅",
      latitude: 34 + 35 / 60,
      longitude: 133 + 3 / 60,
      elevationM: 350,
    });
  });

  it("caches point requests and fetches all 3-hour chunks sequentially", async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => fullHourlyFixture,
      };
    };
    const provider = new JmaAmedasProvider({
      fetcher,
      minRequestIntervalMs: 0,
      now: () => 1_000,
    });
    const location = {
      provider: "JMA_AMEDAS" as const,
      externalId: "67316",
      name: "世羅",
      latitude: 34.5833,
      longitude: 133.05,
      elevationM: 350,
    };
    const values = await provider.fetchDaily(location, "2026-08-01", "2026-08-01");
    expect(values[0].qualityCode).toBe("COMPLETE");
    expect(calls).toHaveLength(8);
    expect(calls[0]).toContain("67316/20260801_00.json");
    await provider.fetchDaily(location, "2026-08-01", "2026-08-01");
    expect(calls).toHaveLength(8);
  });
});

describe("manual CSV weather fallback", () => {
  const location = {
    provider: "JMA_AMEDAS" as const,
    externalId: "67316",
    name: "世羅",
    latitude: 34.5,
    longitude: 133.05,
  };

  it("parses JMA-like headers, quality, and missing values", async () => {
    const values = parseManualDailyWeatherCsv(
      "説明行\n年月日,平均気温(℃),最高気温(℃),最低気温(℃),品質情報\n2026/08/01,25.1,31.0,20.0,0\n2026/08/02,-,30.0,19.0,8\n",
    );
    expect(values[0]).toMatchObject({
      observedDate: "2026-08-01",
      meanTempC: 25.1,
      qualityCode: "COMPLETE",
    });
    expect(values[1]).toMatchObject({
      observedDate: "2026-08-02",
      meanTempC: null,
      qualityCode: "MISSING",
    });
    const provider = new ManualCsvWeatherProvider({ location, values });
    const fetched = await provider.fetchDaily("2026-08-01", "2026-08-03");
    expect(fetched.map((value) => value.qualityCode)).toEqual([
      "COMPLETE",
      "MISSING",
      "MISSING",
    ]);
  });
});

describe("idempotent season recalculation", () => {
  it("does not count a missing day as zero and produces the same result on retry", () => {
    const input = {
      headingDate: "2026-08-01",
      weatherLocationId: "weather-1",
      asOfDate: "2026-08-04",
      rule: {
        harvestStartTempC: 100,
        harvestTargetTempC: 110,
        harvestEndTempC: 120,
        accumulationStartOffsetDays: 1,
      },
      observations: [
        { observedDate: "2026-08-02", meanTempC: 25 },
        { observedDate: "2026-08-03", meanTempC: null },
        { observedDate: "2026-08-04", meanTempC: 27 },
      ],
    } as const;
    const first = calculateSeasonWeatherSummary(input);
    const second = calculateSeasonWeatherSummary(input);
    expect(first).toEqual(second);
    expect(first.accumulatedTempC).toBe(52);
    expect(first.validDayCount).toBe(2);
    expect(first.missingDayCount).toBe(1);
    expect(first.dataStatus).toBe("INCOMPLETE");
  });
});
