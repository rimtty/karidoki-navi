import { getFieldFixture, FIELD_FIXTURES, FIXTURE_RICE_VARIETIES } from "@/features/fields/fixtures";
import type { FieldViewModel, RiceVarietyOption } from "@/features/fields/view-model";
import {
  adaptFieldDetailSimpleRows,
  adaptFieldOverviewRows,
  adaptRiceVarietyRows,
  FieldAdapterError,
} from "./adapters";
import {
  getSupabasePublicConfig,
  SUPABASE_CONFIG_ERROR,
} from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { CONFIRMED_RICE_VARIETY_NAMES } from "@/features/fields/view-model";

export type FieldDataSource = "supabase" | "fixture";

export type FieldDataResult<T> =
  | { data: T; source: FieldDataSource; error: null }
  | { data: null; source: "supabase"; error: string };

const MAP_ERROR =
  "田んぼの情報を取得できませんでした。通信状態を確認して再試行してください。";
const DETAIL_ERROR =
  "田んぼの詳細を取得できませんでした。通信状態を確認して再試行してください。";
const VARIETY_ERROR =
  "品種一覧を取得できませんでした。通信状態を確認して再試行してください。";
const AUTH_ERROR =
  "ログイン状態を確認できませんでした。ログインし直して再試行してください。";
const VARIETY_CONTRACT_ERROR =
  "品種マスターを読み込めませんでした。管理者が設定を確認してください。";

function canUseFixtureFallback(): boolean {
  // Production with a configured Supabase project must surface failures. A
  // missing configuration is intentionally allowed to keep local UI work
  // possible, and non-production environments use the explicit DEV notice.
  return process.env.NODE_ENV !== "production";
}

function fixtureResult<T>(data: T): FieldDataResult<T> {
  return { data, source: "fixture", error: null };
}

function dataError(message: string): FieldDataResult<never> {
  return { data: null, source: "supabase", error: message };
}

function hasRequiredSupabaseAuth(
  result: { data: { user: unknown }; error: unknown },
): result is { data: { user: NonNullable<unknown> }; error: null } {
  return result.error === null && result.data.user !== null;
}

async function authenticatedClient() {
  const client = await createClient();
  const auth = await client.auth.getUser();
  if (!hasRequiredSupabaseAuth(auth)) {
    return { client: null, authError: AUTH_ERROR } as const;
  }
  return { client, authError: null } as const;
}

export async function loadFieldMapData(
  year: number,
): Promise<FieldDataResult<FieldViewModel[]>> {
  const config = getSupabasePublicConfig();
  if (!config) {
    return canUseFixtureFallback()
      ? fixtureResult(FIELD_FIXTURES)
      : dataError(SUPABASE_CONFIG_ERROR);
  }

  try {
    const { client, authError } = await authenticatedClient();
    if (authError || !client) return dataError(authError ?? AUTH_ERROR);

    const { data, error } = await client.rpc("get_field_overview", {
      p_year: year,
    });
    if (error || !data) {
      if (canUseFixtureFallback()) return fixtureResult(FIELD_FIXTURES);
      return dataError(MAP_ERROR);
    }

    try {
      return { data: adaptFieldOverviewRows(data), source: "supabase", error: null };
    } catch (error) {
      if (canUseFixtureFallback() && error instanceof FieldAdapterError) {
        return fixtureResult(FIELD_FIXTURES);
      }
      return dataError(MAP_ERROR);
    }
  } catch {
    if (canUseFixtureFallback()) return fixtureResult(FIELD_FIXTURES);
    return dataError(MAP_ERROR);
  }
}

export async function loadFieldDetailData(
  fieldId: string,
  year: number,
): Promise<FieldDataResult<FieldViewModel | null>> {
  const config = getSupabasePublicConfig();
  if (!config) {
    return canUseFixtureFallback()
      ? fixtureResult(getFieldFixture(fieldId) ?? null)
      : dataError(SUPABASE_CONFIG_ERROR);
  }

  try {
    const { client, authError } = await authenticatedClient();
    if (authError || !client) return dataError(authError ?? AUTH_ERROR);

    const { data, error } = await client.rpc("get_field_detail_simple", {
      p_field_id: fieldId,
      p_year: year,
    });
    if (error || !data) {
      if (canUseFixtureFallback()) {
        return fixtureResult(getFieldFixture(fieldId) ?? null);
      }
      return dataError(DETAIL_ERROR);
    }

    try {
      const fields = adaptFieldDetailSimpleRows(data);
      return {
        data: fields[0] ?? null,
        source: "supabase",
        error: null,
      };
    } catch (error) {
      if (canUseFixtureFallback() && error instanceof FieldAdapterError) {
        return fixtureResult(getFieldFixture(fieldId) ?? null);
      }
      return dataError(DETAIL_ERROR);
    }
  } catch {
    if (canUseFixtureFallback()) {
      return fixtureResult(getFieldFixture(fieldId) ?? null);
    }
    return dataError(DETAIL_ERROR);
  }
}

export async function loadRiceVarieties(): Promise<
  FieldDataResult<RiceVarietyOption[]>
> {
  const config = getSupabasePublicConfig();
  if (!config) {
    return canUseFixtureFallback()
      ? fixtureResult(FIXTURE_RICE_VARIETIES)
      : dataError(SUPABASE_CONFIG_ERROR);
  }

  try {
    const { client, authError } = await authenticatedClient();
    if (authError || !client) return dataError(authError ?? AUTH_ERROR);

    const { data, error } = await client
      .from("rice_varieties")
      .select("*")
      .eq("is_active", true)
      .order("name");
    if (error || !data) {
      if (canUseFixtureFallback()) return fixtureResult(FIXTURE_RICE_VARIETIES);
      return dataError(VARIETY_ERROR);
    }

    try {
      const varieties = adaptRiceVarietyRows(data);
      const availableNames = new Set(varieties.map((variety) => variety.name));
      if (CONFIRMED_RICE_VARIETY_NAMES.some((name) => !availableNames.has(name))) {
        if (canUseFixtureFallback()) return fixtureResult(FIXTURE_RICE_VARIETIES);
        return dataError(VARIETY_CONTRACT_ERROR);
      }
      return { data: varieties, source: "supabase", error: null };
    } catch (error) {
      if (canUseFixtureFallback() && error instanceof FieldAdapterError) {
        return fixtureResult(FIXTURE_RICE_VARIETIES);
      }
      return dataError(VARIETY_ERROR);
    }
  } catch {
    if (canUseFixtureFallback()) return fixtureResult(FIXTURE_RICE_VARIETIES);
    return dataError(VARIETY_ERROR);
  }
}
