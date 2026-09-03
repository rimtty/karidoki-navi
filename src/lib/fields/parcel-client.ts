"use client";

import { PARCEL_CANDIDATE_FIXTURES } from "@/features/fields/fixtures";
import type {
  ParcelCandidateViewModel,
} from "@/features/fields/view-model";
import {
  adaptParcelCandidateRows,
  FieldAdapterError,
} from "./adapters";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/client";

export const PARCEL_CANDIDATE_YEAR = 2026;
export const PARCEL_CANDIDATE_LIMIT = 100;

export type ParcelViewport = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export type ParcelCandidateDataResult =
  | {
      data: ParcelCandidateViewModel[];
      source: "supabase" | "fixture";
      error: null;
    }
  | {
      data: null;
      source: "supabase";
      error: string;
    };

const AUTH_ERROR =
  "筆候補を表示するにはログインが必要です。ログイン状態を確認して再試行してください。";
const LOAD_ERROR =
  "筆候補を取得できませんでした。通信状態を確認して再試行してください。";
const CONTRACT_ERROR =
  "筆候補の形式を確認できませんでした。時間をおいて再試行してください。";
const CONFIG_ERROR =
  "筆候補の接続設定がありません。管理者に連絡して再試行してください。";
const BOUNDS_ERROR =
  "表示範囲が広すぎます。地図を拡大して筆候補を読み込んでください。";

function validViewport(viewport: ParcelViewport): boolean {
  const values = [
    viewport.minLng,
    viewport.minLat,
    viewport.maxLng,
    viewport.maxLat,
  ];
  return (
    values.every(Number.isFinite) &&
    viewport.minLng >= -180 &&
    viewport.maxLng <= 180 &&
    viewport.minLat >= -90 &&
    viewport.maxLat <= 90 &&
    viewport.minLng < viewport.maxLng &&
    viewport.minLat < viewport.maxLat &&
    viewport.maxLng - viewport.minLng <= 0.5 &&
    viewport.maxLat - viewport.minLat <= 0.5 &&
    (viewport.maxLng - viewport.minLng) *
      (viewport.maxLat - viewport.minLat) <=
      0.1
  );
}

export async function loadParcelCandidates(
  viewport: ParcelViewport,
): Promise<ParcelCandidateDataResult> {
  const config = getSupabasePublicConfig();
  if (!config) {
    if (process.env.NODE_ENV === "production") {
      return { data: null, source: "supabase", error: CONFIG_ERROR };
    }
    return {
      data: PARCEL_CANDIDATE_FIXTURES,
      source: "fixture",
      error: null,
    };
  }

  if (!validViewport(viewport)) {
    return { data: null, source: "supabase", error: BOUNDS_ERROR };
  }

  try {
    const client = createClient();
    const auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) {
      return { data: null, source: "supabase", error: AUTH_ERROR };
    }

    const { data, error } = await client.rpc("get_parcel_candidates", {
      p_source_year: PARCEL_CANDIDATE_YEAR,
      p_min_lng: viewport.minLng,
      p_min_lat: viewport.minLat,
      p_max_lng: viewport.maxLng,
      p_max_lat: viewport.maxLat,
      p_limit: PARCEL_CANDIDATE_LIMIT,
      p_municipality_code: "34204",
    });
    if (error || !data) {
      return { data: null, source: "supabase", error: LOAD_ERROR };
    }

    try {
      return {
        data: adaptParcelCandidateRows(data.slice(0, PARCEL_CANDIDATE_LIMIT)),
        source: "supabase",
        error: null,
      };
    } catch (error) {
      if (error instanceof FieldAdapterError) {
        return { data: null, source: "supabase", error: CONTRACT_ERROR };
      }
      return { data: null, source: "supabase", error: LOAD_ERROR };
    }
  } catch {
    return { data: null, source: "supabase", error: LOAD_ERROR };
  }
}
