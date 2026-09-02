#!/usr/bin/env node

/**
 * Reproducible MAFF 2026 Hiroshima parcel import helper.
 *
 * This command deliberately keeps downloaded data outside the repository by
 * default. It downloads all six official split files, joins/unzips them, and
 * writes a JSON audit manifest. The pinned FlatGeobuf reader is used instead
 * of GDAL, so `ogrinfo`/`ogr2ogr` are optional for this workflow.
 *
 * Examples:
 *   pnpm maff:parcels download
 *   pnpm maff:parcels inspect --source-dir /tmp/karidoki-maff-...
 *   pnpm maff:parcels extract --source-dir /tmp/karidoki-maff-...
 */

import { once } from "node:events";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { Readable } from "node:stream";

import {
  DATASET_YEAR,
  KUI_SETTLEMENT_KEY_PREFIX,
  KUI_SETTLEMENT_KEYS,
  MAFF_DOWNLOAD_URLS,
  MAFF_PARCEL_SOURCE_PAGE_URL,
  MAFF_SETTLEMENT_BOUNDARY_URL,
  MAFF_SETTLEMENT_SOURCE_PAGE_URL,
  MUNICIPALITY_CODE,
  PREFECTURE_CODE,
  classifyMaffFeature,
  expectedColumns,
  newFilterCounts,
  normalizeHeader,
  schemaSummary,
} from "./maff-parcel-utils.mjs";

const execFile = promisify(execFileCallback);
const AUDIT_FILE_NAME = "maff-import-audit.json";
const SCHEMA_FILE_NAME = "maff-schema.json";
const ARCHIVE_NAME = "MB0001_2026_2025_34.zip";
const DEFAULT_LAND_TYPE = 100; // MAFF: 100 = 田, 200 = 畑.
const DEFAULT_MAX_DOWNLOAD_RETRIES = 3;

function usage() {
  console.log(`Usage:
  pnpm maff:parcels download [--output-dir DIR] [--force]
  pnpm maff:parcels inspect --source-dir DIR
  pnpm maff:parcels extract --source-dir DIR [--output FILE]
      [--city-only] [--land-type 100|200|all]

Commands:
  download  Fetch all six official split files, join/unzip, inspect, and audit.
  inspect   Re-scan an extracted FlatGeobuf and refresh the schema audit.
  extract   Filter to municipality 34204, official 久井 key prefix 3420424,
            and land_type 100 (田), writing public NDJSON candidates.

Default output is a fresh directory under the operating-system temp folder.
Use --city-only to retain all of municipality 34204 when the settlement filter
is intentionally unavailable. No personal or source-only attributes are copied.
`);
}

function parseArgs(argv) {
  const [command = "help", ...tokens] = argv;
  const options = {};
  const flags = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "force" || name === "city-only") {
      flags.add(name);
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, options, flags };
}

function option(options, name, fallback = undefined) {
  return options[name] ?? fallback;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
  return path;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function downloadOne(url, destination) {
  let lastError;
  for (let attempt = 1; attempt <= DEFAULT_MAX_DOWNLOAD_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "karidoki-navi-maff-import/1.0" },
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const temporaryPath = `${destination}.part`;
      const output = createWriteStream(temporaryPath, { flags: "w" });
      try {
        await pipelineWeb(response.body, output);
        await rename(temporaryPath, destination);
      } catch (error) {
        output.destroy();
        throw error;
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < DEFAULT_MAX_DOWNLOAD_RETRIES) {
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, 500 * attempt),
        );
      }
    }
  }
  throw new Error(`Download failed for ${url}: ${lastError?.message ?? lastError}`);
}

async function pipelineWeb(body, output) {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!output.write(Buffer.from(value))) await once(output, "drain");
    }
    await new Promise((resolvePromise, reject) => {
      output.once("finish", resolvePromise);
      output.once("error", reject);
      output.end();
    });
  } finally {
    reader.releaseLock();
  }
}

async function appendFileToStream(path, output) {
  for await (const chunk of createReadStream(path)) {
    if (!output.write(chunk)) await once(output, "drain");
  }
}

async function joinParts(partPaths, archivePath) {
  const output = createWriteStream(archivePath, { flags: "w" });
  try {
    for (const path of partPaths) await appendFileToStream(path, output);
    await new Promise((resolvePromise, reject) => {
      output.once("finish", resolvePromise);
      output.once("error", reject);
      output.end();
    });
  } catch (error) {
    output.destroy();
    throw error;
  }
}

async function unzipArchive(archivePath, dataDirectory) {
  await ensureDirectory(dataDirectory);
  try {
    await execFile("unzip", ["-q", "-o", archivePath, "-d", dataDirectory]);
  } catch (error) {
    throw new Error(
      `unzip is required to expand the official split archive. ` +
        `Install the standard unzip utility and retry: ${error.message}`,
    );
  }
}

async function findFiles(directory, extension) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findFiles(path, extension)));
    else if (!extension || extname(entry.name).toLowerCase() === extension) files.push(path);
  }
  return files;
}

async function resolveFgb(options) {
  const input = option(options, "input");
  if (input) {
    const path = resolve(input);
    if (!(await pathExists(path))) throw new Error(`FlatGeobuf not found: ${path}`);
    return path;
  }
  const sourceDirectory = option(options, "source-dir");
  if (!sourceDirectory) throw new Error("--source-dir or --input is required");
  const paths = await findFiles(resolve(sourceDirectory), ".fgb");
  if (paths.length !== 1) {
    throw new Error(
      `Expected exactly one extracted .fgb in ${sourceDirectory}; found ${paths.length}`,
    );
  }
  return paths[0];
}

async function sourceDirectoryFromOptions(options) {
  const sourceDirectory = option(options, "source-dir");
  if (sourceDirectory) return resolve(sourceDirectory);
  const input = option(options, "input");
  if (input) return dirname(resolve(input));
  throw new Error("--source-dir or --input is required");
}

async function importFlatGeobuf() {
  // Dynamic import leaves `--help` and unit fixture imports usable even when a
  // caller only wants the command description.
  return import("flatgeobuf/lib/mjs/geojson.js");
}

async function scanFlatGeobuf(path, onFeature) {
  const { deserialize } = await importFlatGeobuf();
  const stream = Readable.toWeb(createReadStream(path));
  let header;
  let scanned = 0;
  const features = deserialize(
    stream,
    undefined,
    (metadata) => {
      header = metadata;
    },
  );
  for await (const feature of features) {
    scanned += 1;
    if (onFeature) await onFeature(feature, scanned);
  }
  if (!header) throw new Error(`FlatGeobuf header was not found: ${path}`);
  return { header, scanned };
}

function updateFilterCounts(counts, feature, classification, options) {
  counts.scanned_features += 1;
  if (classification.status === "invalid_properties") counts.invalid_properties += 1;
  if (classification.status === "invalid_geometry") counts.invalid_geometry += 1;
  if (classification.status === "outside_dataset_year") {
    counts.outside_dataset_year += 1;
    return;
  }
  if (classification.status === "invalid_properties") return;

  const properties = feature?.properties;
  const key = typeof properties?.key === "string" ? properties.key.trim() : "";
  if (classification.status === "outside_municipality") {
    counts.outside_municipality += 1;
  }
  if (!key.startsWith(options.municipalityCode)) return;

  counts.municipality_features += 1;
  if (
    (options.settlementKeyPrefix && !key.startsWith(options.settlementKeyPrefix)) ||
    (options.settlementKeys && !options.settlementKeys.includes(key))
  ) {
    counts.outside_settlement += 1;
    return;
  }
  counts.settlement_features += 1;
  if (options.landType !== null && Number(properties?.land_type) !== options.landType) {
    counts.outside_land_type += 1;
    return;
  }
  counts.land_type_features += 1;
  if (classification.status === "accepted") {
    counts.accepted_features += 1;
    if (classification.wasStructurallyNormalized) {
      counts.structurally_normalized_features += 1;
    }
  }
}

function filterOptions(flags, options) {
  const landTypeOption = option(options, "land-type", String(DEFAULT_LAND_TYPE));
  const landType = landTypeOption === "all" ? null : Number(landTypeOption);
  if (landType !== null && ![100, 200].includes(landType)) {
    throw new Error("--land-type must be 100, 200, or all");
  }
  const municipalityCode = option(options, "municipality-code", MUNICIPALITY_CODE);
  if (!/^\d{5}$/.test(municipalityCode)) {
    throw new Error("--municipality-code must be five digits");
  }
  return {
    datasetYear: DATASET_YEAR,
    municipalityCode,
    settlementKeyPrefix: flags.has("city-only")
      ? null
      : option(options, "settlement-prefix", KUI_SETTLEMENT_KEY_PREFIX),
    settlementKeys: flags.has("city-only")
      ? null
      : option(options, "settlement-prefix")
        ? null
        : KUI_SETTLEMENT_KEYS,
    landType,
  };
}

async function inspectCommand(options) {
  const fgbPath = await resolveFgb(options);
  const sourceDirectory = await sourceDirectoryFromOptions(options);
  const result = await scanFlatGeobuf(fgbPath);
  const summary = schemaSummary(result.header);
  if (!summary.schema_matches) {
    throw new Error(
      `Unexpected MAFF schema in ${fgbPath}; expected ${expectedColumns().join(", ")}`,
    );
  }

  const schemaAudit = {
    source_file: fgbPath,
    inspected_at: new Date().toISOString(),
    ...summary,
    scanned_features: result.scanned,
    feature_count_matches_header: result.scanned === summary.feature_count,
  };
  await writeFile(
    join(sourceDirectory, SCHEMA_FILE_NAME),
    `${JSON.stringify(schemaAudit, null, 2)}\n`,
    "utf8",
  );

  const auditPath = join(sourceDirectory, AUDIT_FILE_NAME);
  if (await pathExists(auditPath)) {
    const audit = JSON.parse(await readFile(auditPath, "utf8"));
    audit.schema = schemaAudit;
    audit.source_feature_count = result.scanned;
    audit.inspected_at = schemaAudit.inspected_at;
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(schemaAudit, null, 2));
  return schemaAudit;
}

async function downloadCommand(options, flags) {
  const requestedOutputDirectory = option(options, "output-dir");
  const outputDirectory = resolve(
    requestedOutputDirectory ?? (await mkdtemp(join(tmpdir(), "karidoki-maff-2026-34-"))),
  );
  const auditPath = join(outputDirectory, AUDIT_FILE_NAME);
  if ((await pathExists(auditPath)) && !flags.has("force")) {
    throw new Error(`${auditPath} already exists; pass --force to refresh it`);
  }
  const rawDirectory = await ensureDirectory(join(outputDirectory, "raw"));
  const dataDirectory = await ensureDirectory(join(outputDirectory, "data"));
  const retrievedAt = new Date().toISOString();
  const parts = [];

  for (let index = 0; index < MAFF_DOWNLOAD_URLS.length; index += 1) {
    const url = MAFF_DOWNLOAD_URLS[index];
    const path = join(rawDirectory, basename(url));
    if (flags.has("force") || !(await pathExists(path))) {
      await downloadOne(url, path);
    }
    const fileHash = await hashFile(path);
    parts.push({
      part: index + 1,
      url,
      local_path: path,
      retrieved_at: retrievedAt,
      ...fileHash,
    });
  }

  const archivePath = join(outputDirectory, ARCHIVE_NAME);
  await joinParts(parts.map((part) => part.local_path), archivePath);
  const archiveHash = await hashFile(archivePath);
  await unzipArchive(archivePath, dataDirectory);
  const fgbPath = await resolveFgb({ "source-dir": outputDirectory });
  const fgbHash = await hashFile(fgbPath);
  const scan = await scanFlatGeobuf(fgbPath);
  const schema = schemaSummary(scan.header);
  if (!schema.schema_matches || scan.scanned !== schema.feature_count) {
    throw new Error("Official FlatGeobuf schema/count validation failed");
  }

  const audit = {
    manifest_version: 1,
    provider: "MAFF",
    dataset_name: "MB0001_2026_2025_34",
    dataset_year: DATASET_YEAR,
    prefecture_code: PREFECTURE_CODE,
    municipality_code: MUNICIPALITY_CODE,
    source_page_url: MAFF_PARCEL_SOURCE_PAGE_URL,
    settlement_boundary_source_page_url: MAFF_SETTLEMENT_SOURCE_PAGE_URL,
    settlement_boundary_url: MAFF_SETTLEMENT_BOUNDARY_URL,
    downloaded_at: retrievedAt,
    required_split_count: MAFF_DOWNLOAD_URLS.length,
    parts,
    archive: { local_path: archivePath, ...archiveHash },
    source_file: { local_path: fgbPath, ...fgbHash },
    source_feature_count: scan.scanned,
    schema,
    filter_contract: {
      municipality_key_prefix: MUNICIPALITY_CODE,
      settlement_key_prefix: KUI_SETTLEMENT_KEY_PREFIX,
      settlement_key_count: KUI_SETTLEMENT_KEYS.length,
      settlement_keys: KUI_SETTLEMENT_KEYS,
      land_type_default: DEFAULT_LAND_TYPE,
      land_type_meaning: { "100": "田", "200": "畑" },
      note:
        "3420424 is the official 2025 MAFF agricultural-settlement boundary KCity=24 (久井村) prefix used for the modern 久井町 pilot area.",
    },
  };
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  await writeFile(
    join(outputDirectory, SCHEMA_FILE_NAME),
    `${JSON.stringify({ ...schema, source_file: fgbPath, scanned_features: scan.scanned }, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ output_directory: outputDirectory, audit_path: auditPath, audit }, null, 2));
  return outputDirectory;
}

async function extractCommand(options, flags) {
  const fgbPath = await resolveFgb(options);
  const sourceDirectory = await sourceDirectoryFromOptions(options);
  const filters = filterOptions(flags, options);
  const outputPath = resolve(
    option(
      options,
      "output",
      join(
        sourceDirectory,
        "generated",
        `parcel-candidates-${filters.datasetYear}-${filters.municipalityCode}-${filters.settlementKeyPrefix ? "kui" : "city"}.ndjson`,
      ),
    ),
  );
  await ensureDirectory(dirname(outputPath));
  const output = createWriteStream(outputPath, { flags: "w" });
  const counts = newFilterCounts();
  let writeError;
  output.once("error", (error) => {
    writeError = error;
  });

  let scan;
  try {
    scan = await scanFlatGeobuf(fgbPath, async (feature) => {
      const classification = classifyMaffFeature(feature, filters);
      updateFilterCounts(counts, feature, classification, filters);
      if (classification.status !== "accepted") return;
      const line = `${JSON.stringify(classification.feature)}\n`;
      if (!output.write(line)) await once(output, "drain");
    });
    await new Promise((resolvePromise, reject) => {
      output.once("finish", resolvePromise);
      output.once("error", reject);
      output.end();
    });
  } catch (error) {
    output.destroy();
    throw error;
  }
  if (writeError) throw writeError;

  const outputHash = await hashFile(outputPath);
  const result = {
    generated_at: new Date().toISOString(),
    source_file: fgbPath,
    source_feature_count: scan.scanned,
    source_header: normalizeHeader(scan.header),
    filters: {
      dataset_year: filters.datasetYear,
      municipality_code: filters.municipalityCode,
      settlement_key_prefix: filters.settlementKeyPrefix,
      settlement_keys: filters.settlementKeys,
      land_type: filters.landType,
    },
    counts,
    output: { local_path: outputPath, ...outputHash, format: "GeoJSON Lines" },
    postgis_import_note:
      "Use the migration's normalize_parcel_candidate_geometry() so ST_MakeValid and repair counts are recorded in source_imports.",
  };

  const auditPath = join(sourceDirectory, AUDIT_FILE_NAME);
  if (await pathExists(auditPath)) {
    const audit = JSON.parse(await readFile(auditPath, "utf8"));
    audit.extraction = result;
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  }
  const extractionAuditPath = `${outputPath}.audit.json`;
  await writeFile(extractionAuditPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "help" || parsed.command === "--help") {
    usage();
    return;
  }
  if (parsed.command === "download") {
    await downloadCommand(parsed.options, parsed.flags);
    return;
  }
  if (parsed.command === "inspect") {
    await inspectCommand(parsed.options);
    return;
  }
  if (parsed.command === "extract") {
    await extractCommand(parsed.options, parsed.flags);
    return;
  }
  throw new Error(`Unknown command: ${parsed.command}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && resolve(new URL(import.meta.url).pathname) === invokedPath) {
  main().catch((error) => {
    console.error(`maff-parcels: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  extractCommand,
  filterOptions,
  inspectCommand,
  normalizeHeader,
  updateFilterCounts,
};
