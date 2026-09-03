/**
 * Small, dependency-free parts of the MAFF parcel import contract.
 *
 * The FlatGeobuf reader itself is supplied by the pinned `flatgeobuf`
 * package. Keeping filtering and normalization here makes the rules usable in
 * a fixture test without opening a 343 MB source file.
 */

export const MAFF_PARCEL_SOURCE_PAGE_URL =
  "https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/index.html";
export const MAFF_SETTLEMENT_SOURCE_PAGE_URL =
  "https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/ma/index.html";
export const MAFF_SETTLEMENT_BOUNDARY_URL =
  "https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/ma/MA0001_2025_2025_34.zip";

export const DATASET_YEAR = 2026;
export const PREFECTURE_CODE = "34";
export const MUNICIPALITY_CODE = "34204";

// The 2025 MAFF agricultural-settlement boundary data identifies the former
// 久井村 area with KCity code 24. The 2026 parcel `key` is the 10-digit
// municipality/old-municipality/settlement key, so this prefix is the
// official, reproducible 久井町 filter (14 settlement keys).
export const KUI_SETTLEMENT_KEY_PREFIX = "3420424";
export const KUI_SETTLEMENT_KEYS = Object.freeze(
  Array.from({ length: 14 }, (_, index) =>
    `${KUI_SETTLEMENT_KEY_PREFIX}${String(index + 1).padStart(3, "0")}`,
  ),
);

export const MAFF_DOWNLOAD_URLS = Object.freeze(
  Array.from({ length: 6 }, (_, index) => {
    const part = String(index + 1).padStart(3, "0");
    return `https://www.maff.go.jp/j/tokei/census/shuraku_data/2025/mb/MB0001_2026_2025_34.zip.${part}`;
  }),
);

const EXPECTED_COLUMNS = Object.freeze([
  "polygon_uuid",
  "land_type",
  "issue_year",
  "point_lng",
  "point_lat",
  "key",
]);

export function expectedColumns() {
  return [...EXPECTED_COLUMNS];
}

export function normalizeHeader(header) {
  const columns = Array.isArray(header?.columns)
    ? header.columns.map((column) => ({
        name: column?.name ?? null,
        type: column?.type ?? null,
        width: column?.width ?? null,
        precision: column?.precision ?? null,
        scale: column?.scale ?? null,
        nullable: column?.nullable ?? null,
      }))
    : [];

  return {
    geometry_type: header?.geometryType ?? null,
    feature_count: Number.isSafeInteger(header?.featuresCount)
      ? header.featuresCount
      : null,
    index_node_size: Number.isSafeInteger(header?.indexNodeSize)
      ? header.indexNodeSize
      : null,
    envelope: header?.envelope ? Array.from(header.envelope) : null,
    crs: header?.crs
      ? {
          org: header.crs.org ?? null,
          code: header.crs.code ?? null,
          name: header.crs.name ?? null,
        }
      : null,
    columns,
  };
}

export function schemaSummary(header) {
  const normalized = normalizeHeader(header);
  const actualColumns = normalized.columns.map((column) => column.name);
  return {
    ...normalized,
    expected_columns: expectedColumns(),
    actual_columns: actualColumns,
    schema_matches:
      normalized.geometry_type === 6 &&
      normalized.crs?.org === "EPSG" &&
      normalized.crs?.code === 4612 &&
      actualColumns.length === EXPECTED_COLUMNS.length &&
      actualColumns.every((name, index) => name === EXPECTED_COLUMNS[index]),
  };
}

function isFiniteCoordinate(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function sameCoordinate(a, b) {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}

function normalizeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  if (!ring.every(isFiniteCoordinate)) return null;

  const coordinates = ring.map(([lng, lat]) => [lng, lat]);
  if (!sameCoordinate(coordinates[0], coordinates.at(-1))) {
    coordinates.push([...coordinates[0]]);
  }
  if (coordinates.length < 4) return null;
  return coordinates;
}

/**
 * Normalize the two polygon forms accepted by the fixture and source data to
 * a MultiPolygon. This is structural normalization only; robust topology
 * repair is deliberately performed by PostGIS ST_MakeValid during import.
 */
export function normalizeGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;

  let polygons;
  if (geometry.type === "Polygon") {
    polygons = [geometry.coordinates];
  } else if (geometry.type === "MultiPolygon") {
    polygons = geometry.coordinates;
  } else {
    return null;
  }

  if (!Array.isArray(polygons) || polygons.length === 0) return null;

  const normalizedPolygons = polygons.map((polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) return null;
    const rings = polygon.map(normalizeRing);
    return rings.every(Boolean) ? rings : null;
  });
  if (normalizedPolygons.some((polygon) => polygon === null)) return null;

  return {
    geometry: {
      type: "MultiPolygon",
      coordinates: normalizedPolygons,
    },
    was_structurally_normalized:
      geometry.type !== "MultiPolygon" ||
      JSON.stringify(geometry.coordinates) !==
        JSON.stringify(normalizedPolygons),
  };
}

function normalizedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Classify and normalize one source feature. The returned object intentionally
 * contains only public reference attributes; point coordinates and any future
 * source columns are not copied into the candidate payload.
 */
export function classifyMaffFeature(
  feature,
  {
    datasetYear = DATASET_YEAR,
    municipalityCode = MUNICIPALITY_CODE,
    settlementKeyPrefix = KUI_SETTLEMENT_KEY_PREFIX,
    settlementKeys = /** @type {readonly string[] | null} */ (null),
    landType = 100,
  } = {},
) {
  const properties = feature?.properties;
  if (!properties || typeof properties !== "object") {
    return { status: "invalid_properties", reason: "properties_missing" };
  }

  const polygonUuid = normalizedText(properties.polygon_uuid);
  const key = normalizedText(properties.key);
  const issueYear = normalizedInteger(properties.issue_year);
  const sourceLandType = normalizedInteger(properties.land_type);

  if (!polygonUuid || !key || !/^\d{10}$/.test(key)) {
    return { status: "invalid_properties", reason: "source_key_or_id" };
  }
  if (![100, 200].includes(sourceLandType)) {
    return { status: "invalid_properties", reason: "source_land_type" };
  }
  if (issueYear !== datasetYear) {
    return { status: "outside_dataset_year" };
  }
  if (!key.startsWith(municipalityCode)) {
    return { status: "outside_municipality" };
  }

  if (
    (settlementKeyPrefix && !key.startsWith(settlementKeyPrefix)) ||
    (settlementKeys && !settlementKeys.includes(key))
  ) {
    return { status: "outside_settlement" };
  }
  if (landType !== null && sourceLandType !== landType) {
    return { status: "outside_land_type" };
  }

  const normalized = normalizeGeometry(feature.geometry);
  if (!normalized) {
    return { status: "invalid_geometry", reason: "polygon_structure" };
  }

  return {
    status: "accepted",
    feature: {
      type: "Feature",
      properties: {
        source_feature_id: polygonUuid,
        source_year: issueYear,
        municipality_code: key.slice(0, 5),
        settlement_code: key,
        land_type: sourceLandType,
      },
      geometry: normalized.geometry,
    },
    wasStructurallyNormalized: normalized.was_structurally_normalized,
  };
}

export function newFilterCounts() {
  return {
    scanned_features: 0,
    invalid_properties: 0,
    invalid_geometry: 0,
    outside_dataset_year: 0,
    outside_municipality: 0,
    municipality_features: 0,
    outside_settlement: 0,
    settlement_features: 0,
    outside_land_type: 0,
    land_type_features: 0,
    accepted_features: 0,
    structurally_normalized_features: 0,
  };
}
