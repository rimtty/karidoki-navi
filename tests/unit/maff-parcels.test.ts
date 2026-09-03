import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KUI_SETTLEMENT_KEY_PREFIX,
  classifyMaffFeature,
  normalizeGeometry,
  schemaSummary,
} from "../../scripts/maff-parcel-utils.mjs";

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../fixtures/maff/mini.geojson", import.meta.url)),
    "utf8",
  ),
);
const features = fixture.features as Array<{
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
}>;

describe("MAFF parcel fixture normalization", () => {
  it("normalizes Polygon to MultiPolygon and closes an open ring", () => {
    const result = normalizeGeometry(features[0].geometry);
    if (!result) throw new Error("fixture geometry should normalize");
    const ring = result.geometry.coordinates[0]?.[0];
    if (!ring) throw new Error("fixture ring should normalize");

    expect(result.geometry.type).toBe("MultiPolygon");
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring.at(-1));
    expect(result.was_structurally_normalized).toBe(true);
  });

  it("keeps only public candidate attributes for the official 久井 prefix", () => {
    const result = classifyMaffFeature(features[0]);

    expect(result.status).toBe("accepted");
    if (result.status !== "accepted" || !result.feature) return;
    const acceptedFeature = result.feature;
    expect(acceptedFeature.properties).toEqual({
      source_feature_id: "11111111-1111-4111-8111-111111111111",
      source_year: 2026,
      municipality_code: "34204",
      settlement_code: "3420424001",
      land_type: 100,
    });
    expect(acceptedFeature.properties).not.toHaveProperty("point_lng");
    expect(acceptedFeature.properties).not.toHaveProperty("point_lat");
    expect(KUI_SETTLEMENT_KEY_PREFIX).toBe("3420424");
    expect(
      classifyMaffFeature(features[0], { settlementKeys: ["3420424002"] }).status,
    ).toBe("outside_settlement");
  });

  it("classifies municipality, settlement, land type, year, and geometry boundaries", () => {
    const statuses = features.map((feature) =>
      classifyMaffFeature(feature).status,
    );

    expect(statuses).toEqual([
      "accepted",
      "accepted",
      "outside_settlement",
      "outside_municipality",
      "outside_land_type",
      "outside_dataset_year",
      "invalid_geometry",
    ]);
  });

  it("records the real FlatGeobuf schema contract", () => {
    const result = schemaSummary({
      geometryType: 6,
      featuresCount: 2,
      indexNodeSize: 16,
      envelope: [132, 34, 133, 35],
      crs: { org: "EPSG", code: 4612, name: "JGD2000" },
      columns: [
        { name: "polygon_uuid", type: 11, width: 36, precision: -1, scale: -1, nullable: true },
        { name: "land_type", type: 7, width: 10, precision: -1, scale: -1, nullable: true },
        { name: "issue_year", type: 7, width: 10, precision: -1, scale: -1, nullable: true },
        { name: "point_lng", type: 10, width: -1, precision: 19, scale: 11, nullable: true },
        { name: "point_lat", type: 10, width: -1, precision: 19, scale: 11, nullable: true },
        { name: "key", type: 11, width: 12, precision: -1, scale: -1, nullable: true },
      ],
    });

    expect(result.schema_matches).toBe(true);
    expect(result.actual_columns).toEqual([
      "polygon_uuid",
      "land_type",
      "issue_year",
      "point_lng",
      "point_lat",
      "key",
    ]);
  });
});
