"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import {
  FIELD_STATUS_META,
  PILOT_REGION,
  type Coordinate,
  type FieldFixture,
} from "./fixtures";
import styles from "./field-map.module.css";

const FIELDS_SOURCE_ID = "development-fields";
const DRAFT_SOURCE_ID = "manual-draft";
const FIELD_FILL_LAYER_ID = "development-fields-fill";
const FIELD_LINE_LAYER_ID = "development-fields-line";
const FIELD_LABEL_LAYER_ID = "development-fields-label";
const DRAFT_FILL_LAYER_ID = "manual-draft-fill";
const DRAFT_LINE_LAYER_ID = "manual-draft-line";
const DRAFT_POINT_LAYER_ID = "manual-draft-point";

type MapProps = {
  fields?: FieldFixture[];
  selectedId?: string | null;
  onSelect?: (field: FieldFixture) => void;
  drawMode?: boolean;
  draftPolygon?: Coordinate[];
  onDraftPolygonChange?: (polygon: Coordinate[]) => void;
  className?: string;
  ariaLabel?: string;
};

type FieldProperties = {
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  selected: boolean;
};

type MapGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Point"; coordinates: number[] };

type MapFeature = {
  type: "Feature";
  id?: string;
  properties: FieldProperties | null;
  geometry: MapGeometry;
};

type MapGeoJson = { type: "FeatureCollection"; features: MapFeature[] };

type SourceData = Parameters<GeoJSONSource["setData"]>[0];

function asSourceData(data: MapGeoJson): SourceData {
  return data as unknown as SourceData;
}

function toFieldGeoJson(fields: FieldFixture[], selectedId: string | null | undefined) {
  return {
    type: "FeatureCollection" as const,
    features: fields.map((field) => ({
      type: "Feature" as const,
      id: field.id,
      properties: {
        id: field.id,
        name: field.name,
        status: field.status,
        statusLabel: FIELD_STATUS_META[field.status].label,
        selected: field.id === selectedId,
      } satisfies FieldProperties,
      geometry: {
        type: "Polygon" as const,
        coordinates: [[...field.polygon, field.polygon[0]]],
      },
    })),
  };
}

function toDraftGeoJson(polygon: Coordinate[]) {
  const features: MapFeature[] = [];

  if (polygon.length >= 3) {
    features.push({
      type: "Feature",
      properties: null,
      geometry: {
        type: "Polygon",
        coordinates: [[...polygon, polygon[0]]],
      },
    });
  }

  if (polygon.length >= 2) {
    features.push({
      type: "Feature",
      properties: null,
      geometry: { type: "LineString", coordinates: polygon },
    });
  }

  polygon.forEach((point) => {
    features.push({
      type: "Feature",
      properties: null,
      geometry: { type: "Point", coordinates: point },
    });
  });

  return {
    type: "FeatureCollection" as const,
    features,
  };
}

export function FieldMap({
  fields = [],
  selectedId = null,
  onSelect,
  drawMode = false,
  draftPolygon = [],
  onDraftPolygonChange,
  className,
  ariaLabel = "圃場マップ",
}: MapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const fieldsRef = useRef(fields);
  const selectedIdRef = useRef(selectedId);
  const drawModeRef = useRef(drawMode);
  const draftPolygonRef = useRef(draftPolygon);
  const onSelectRef = useRef(onSelect);
  const onDraftPolygonChangeRef = useRef(onDraftPolygonChange);
  const [mapError, setMapError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const fieldGeoJson = useMemo(() => toFieldGeoJson(fields, selectedId), [fields, selectedId]);

  useEffect(() => {
    fieldsRef.current = fields;
    selectedIdRef.current = selectedId;
    drawModeRef.current = drawMode;
    draftPolygonRef.current = draftPolygon;
    onSelectRef.current = onSelect;
    onDraftPolygonChangeRef.current = onDraftPolygonChange;

    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const fieldSource = map.getSource(FIELDS_SOURCE_ID) as GeoJSONSource | undefined;
    fieldSource?.setData(asSourceData(fieldGeoJson));
    const draftSource = map.getSource(DRAFT_SOURCE_ID) as GeoJSONSource | undefined;
    draftSource?.setData(asSourceData(toDraftGeoJson(draftPolygon)));
    map.getCanvas().style.cursor = drawMode ? "crosshair" : "";
  }, [drawMode, draftPolygon, fieldGeoJson, fields, onDraftPolygonChange, onSelect, selectedId]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: PILOT_REGION.center,
      zoom: PILOT_REGION.zoom,
      minZoom: 9,
      maxZoom: 19,
      attributionControl: false,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          gsi: {
            type: "raster",
            tiles: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>',
          },
        },
        layers: [{ id: "gsi-base", type: "raster", source: "gsi" }],
      },
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const handleMapError = () => setMapError(true);
    map.on("error", handleMapError);

    map.once("load", () => {
      map.addSource(FIELDS_SOURCE_ID, { type: "geojson", data: asSourceData(toFieldGeoJson(fieldsRef.current, selectedIdRef.current)) });
      map.addLayer({
        id: FIELD_FILL_LAYER_ID,
        type: "fill",
        source: FIELDS_SOURCE_ID,
        paint: {
          "fill-color": [
            "match",
            ["get", "status"],
            "ready",
            "#d9ad2b",
            "soon",
            "#d6c95c",
            "growing",
            "#83b36b",
            "overdue",
            "#cf7864",
            "harvested",
            "#83a595",
            "#aab6a4",
          ],
          "fill-opacity": ["case", ["boolean", ["get", "selected"], false], 0.9, 0.72],
        },
      });
      map.addLayer({
        id: FIELD_LINE_LAYER_ID,
        type: "line",
        source: FIELDS_SOURCE_ID,
        paint: {
          "line-color": ["case", ["boolean", ["get", "selected"], false], "#183d1e", "#ffffff"],
          "line-width": ["case", ["boolean", ["get", "selected"], false], 3, 2],
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: FIELD_LABEL_LAYER_ID,
        type: "symbol",
        source: FIELDS_SOURCE_ID,
        layout: {
          "text-field": ["concat", ["get", "name"], "\n", ["get", "statusLabel"]],
          "text-size": 11,
          "text-font": ["Open Sans Regular"],
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: {
          "text-color": "#18351d",
          "text-halo-color": "#ffffff",
          "text-halo-width": 2,
        },
      });
      map.addSource(DRAFT_SOURCE_ID, { type: "geojson", data: asSourceData(toDraftGeoJson(draftPolygonRef.current)) });
      map.addLayer({
        id: DRAFT_FILL_LAYER_ID,
        type: "fill",
        source: DRAFT_SOURCE_ID,
        filter: ["==", "$type", "Polygon"],
        paint: { "fill-color": "#315c2b", "fill-opacity": 0.22 },
      });
      map.addLayer({
        id: DRAFT_LINE_LAYER_ID,
        type: "line",
        source: DRAFT_SOURCE_ID,
        filter: ["==", "$type", "LineString"],
        paint: { "line-color": "#315c2b", "line-width": 3, "line-dasharray": [1, 1] },
      });
      map.addLayer({
        id: DRAFT_POINT_LAYER_ID,
        type: "circle",
        source: DRAFT_SOURCE_ID,
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#315c2b",
          "circle-stroke-width": 3,
        },
      });

      map.on("click", FIELD_FILL_LAYER_ID, (event: MapLayerMouseEvent) => {
        if (drawModeRef.current) return;
        const id = event.features?.[0]?.properties?.id;
        const field = fieldsRef.current.find((candidate) => candidate.id === id);
        if (field) onSelectRef.current?.(field);
      });
      map.on("mouseenter", FIELD_FILL_LAYER_ID, () => {
        if (!drawModeRef.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", FIELD_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = drawModeRef.current ? "crosshair" : "";
      });
      map.on("click", (event: MapMouseEvent) => {
        if (!drawModeRef.current) return;
        const next = [...draftPolygonRef.current, [event.lngLat.lng, event.lngLat.lat] as Coordinate];
        draftPolygonRef.current = next;
        onDraftPolygonChangeRef.current?.(next);
        const draftSource = map.getSource(DRAFT_SOURCE_ID) as GeoJSONSource | undefined;
        draftSource?.setData(asSourceData(toDraftGeoJson(next)));
      });
      setMapReady(true);
    });

    return () => {
      map.off("error", handleMapError);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  return (
    <div className={`${styles.mapFrame} ${className ?? ""}`}>
      <div ref={containerRef} className={styles.map} role="application" aria-label={ariaLabel} />
      <div className={styles.regionTag}>
        <span className={styles.locationGlyph} aria-hidden="true">
          ●
        </span>
        {PILOT_REGION.name}
      </div>
      {!mapReady && !mapError && <div className={styles.mapState}>地図を読み込み中…</div>}
      {mapError && (
        <div className={styles.mapError} role="alert">
          <strong>地図を読み込めません</strong>
          <span>通信状態を確認して再読み込みしてください。</span>
        </div>
      )}
      {drawMode && (
        <div className={styles.drawHint} role="status">
          地図をタップして点を追加
        </div>
      )}
    </div>
  );
}
