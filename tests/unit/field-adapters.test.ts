import { describe, expect, it } from "vitest";
import {
  adaptFieldDetailRow,
  adaptFieldMapRow,
  adaptParcelCandidateRow,
  adaptRiceVarietyRows,
  FieldAdapterError,
} from "../../src/lib/fields/adapters";

const polygon = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [133, 34.5],
        [133.001, 34.5],
        [133.001, 34.501],
        [133, 34.501],
        [133, 34.5],
      ],
    ],
  ],
};

describe("field RPC adapters", () => {
  it("converts Postgres numeric strings and MultiPolygon geometry", () => {
    const field = adaptFieldMapRow({
      field_id: "field-1",
      field_name: "東圃場",
      geom_geojson: polygon,
      area_m2: "1234.50",
      season_id: "season-1",
      season_year: 2026,
      variety_id: "variety-1",
      variety_name: "コシヒカリ",
      heading_date: "2026-08-01",
      harvest_date: null,
      accumulated_temp_c: "998.40",
      maturity_status: "HARVEST_READY",
      data_status: "COMPLETE",
      accumulated_through: "2026-09-02",
    });

    expect(field).toMatchObject({
      id: "field-1",
      areaM2: 1234.5,
      accumulatedTempC: 998.4,
      status: "ready",
      dataQuality: "complete",
      polygon: [
        [133, 34.5],
        [133.001, 34.5],
        [133.001, 34.501],
        [133, 34.501],
      ],
    });
  });

  it("derives harvested status from the persisted harvest date", () => {
    const field = adaptFieldDetailRow({
      field_id: "field-1",
      field_name: "東圃場",
      geom_geojson: {
        type: "Polygon",
        coordinates: [
          [
            [133, 34.5],
            [133.001, 34.5],
            [133.001, 34.501],
            [133, 34.501],
            [133, 34.5],
          ],
        ],
      },
      area_m2: 100,
      season_id: "season-1",
      season_year: 2026,
      variety_id: null,
      variety_name: null,
      heading_date: null,
      harvest_date: "2026-09-03",
      harvest_accumulated_temp_c: "1100",
      lifecycle_status: "HARVESTED",
      accumulated_temp_c: null,
      maturity_status: "OVERDUE",
      data_status: "PENDING",
      accumulated_through: null,
      valid_day_count: 0,
      missing_day_count: 0,
      estimated_days_to_start: null,
    });

    expect(field.status).toBe("harvested");
    expect(field.harvestAccumulatedTempC).toBe(1100);
  });

  it("rejects malformed geometry instead of silently returning a fixture", () => {
    expect(() =>
      adaptFieldMapRow({
        field_id: "field-1",
        field_name: "不正",
        geom_geojson: { type: "Point", coordinates: [133, 34.5] },
        area_m2: 1,
        season_id: null,
        season_year: null,
        variety_id: null,
        variety_name: null,
        heading_date: null,
        harvest_date: null,
        accumulated_temp_c: null,
        maturity_status: null,
        data_status: null,
        accumulated_through: null,
      }),
    ).toThrow(FieldAdapterError);
  });
});

describe("rice variety adapter", () => {
  it("keeps only the confirmed active five and preserves product order", () => {
    const varieties = adaptRiceVarietyRows([
      {
        id: "unknown",
        name: "未知品種",
        name_kana: null,
        is_active: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "hino",
        name: "ヒノヒカリ",
        name_kana: null,
        is_active: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "kosh",
        name: "コシヒカリ",
        name_kana: null,
        is_active: true,
        created_at: "",
        updated_at: "",
      },
      {
        id: "inactive",
        name: "恋の予感",
        name_kana: null,
        is_active: false,
        created_at: "",
        updated_at: "",
      },
    ]);

    expect(varieties.map((variety) => variety.name)).toEqual([
      "コシヒカリ",
      "ヒノヒカリ",
    ]);
  });
});

describe("parcel candidate adapter", () => {
  it("normalizes all Polygon parts while exposing only public reference fields", () => {
    const candidate = adaptParcelCandidateRow({
      candidate_id: "candidate-1",
      source_import_id: "import-1",
      source_year: 2026,
      source_feature_id: "parcel-001",
      municipality_code: "34204",
      settlement_code: "3420424001",
      land_type: 100,
      area_m2: "987.65",
      geom_geojson: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [133, 34.5],
              [133.001, 34.5],
              [133.001, 34.501],
              [133, 34.501],
              [133, 34.5],
            ],
          ],
          [
            [
              [133.002, 34.5],
              [133.003, 34.5],
              [133.003, 34.501],
              [133.002, 34.501],
              [133.002, 34.5],
            ],
          ],
        ],
      },
    });

    expect(candidate).toMatchObject({
      id: "candidate-1",
      externalId: "parcel-001",
      datasetYear: 2026,
      municipalityCode: "34204",
      settlementCode: "3420424001",
      landType: 100,
      areaM2: 987.65,
      label: "筆候補 parcel-0",
    });
    expect(candidate.geometry.type).toBe("MultiPolygon");
    expect(candidate.geometry.coordinates).toHaveLength(2);
    expect(candidate.geometry.coordinates[0]?.[0]).toHaveLength(4);
    expect(candidate).not.toHaveProperty("ownerId");
  });

  it("rejects a candidate outside the configured municipality contract", () => {
    expect(() =>
      adaptParcelCandidateRow({
        candidate_id: "candidate-1",
        source_import_id: "import-1",
        source_year: 2026,
        source_feature_id: "parcel-001",
        municipality_code: "3420",
        settlement_code: "3410024001",
        land_type: 100,
        area_m2: 10,
        geom_geojson: polygon,
      }),
    ).toThrow(FieldAdapterError);
  });
});
