"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FixtureNotice } from "@/components/quality-notice";
import { DataLoadError } from "@/components/data-load-error";
import { FieldMap } from "./field-map";
import {
  DEVELOPMENT_RULE,
  FIELD_FIXTURES,
  FIXTURE_RICE_VARIETIES,
  PILOT_REGION,
  RICE_VARIETIES,
  formatDate,
  type Coordinate,
  type RiceVariety,
} from "./fixtures";
import type { RiceVarietyOption } from "./view-model";
import { registerFieldWithSeasonAction } from "@/lib/fields/actions";
import styles from "./field-registration-view.module.css";

const DRAFT_STORAGE_KEY = "karidoki-navi:field-registration-draft";

type SelectionMode = "parcel" | "draw";

type RegistrationDraft = {
  fieldName: string;
  variety: RiceVariety | "";
  varietyId: string;
  headingDate: string;
  selectionMode: SelectionMode;
  selectedParcelId: string | null;
  polygon: Coordinate[];
  idempotencyKey: string;
};

const blankDraft: RegistrationDraft = {
  fieldName: "",
  variety: "",
  varietyId: "",
  headingDate: "",
  selectionMode: "parcel",
  selectedParcelId: null,
  polygon: [],
  idempotencyKey: "",
};

const steps = [
  { number: 1, label: "区画を選ぶ" },
  { number: 2, label: "作付け入力" },
  { number: 3, label: "確認" },
];

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function readDraft(value: string): RegistrationDraft | null {
  try {
    const parsed = JSON.parse(value) as Partial<RegistrationDraft>;
    const selectionMode = parsed.selectionMode === "draw" ? "draw" : "parcel";
    const polygon = Array.isArray(parsed.polygon) ? parsed.polygon.filter(isCoordinate) : [];
    const variety = RICE_VARIETIES.includes(parsed.variety as RiceVariety) ? (parsed.variety as RiceVariety) : "";
    return {
      fieldName: typeof parsed.fieldName === "string" ? parsed.fieldName : "",
      variety,
      varietyId: typeof parsed.varietyId === "string" ? parsed.varietyId : "",
      headingDate: typeof parsed.headingDate === "string" ? parsed.headingDate : "",
      selectionMode,
      selectedParcelId: typeof parsed.selectedParcelId === "string" ? parsed.selectedParcelId : null,
      polygon,
      idempotencyKey: typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : "",
    };
  } catch {
    return null;
  }
}

function polygonAreaM2(polygon: Coordinate[]): number {
  if (polygon.length < 3) return 0;
  const latitude = polygon.reduce((total, point) => total + point[1], 0) / polygon.length;
  const metersPerLatitudeDegree = 111_320;
  const metersPerLongitudeDegree = metersPerLatitudeDegree * Math.cos((latitude * Math.PI) / 180);
  const origin = polygon[0];
  const points = polygon.map(([longitude, lat]) => [
    (longitude - origin[0]) * metersPerLongitudeDegree,
    (lat - origin[1]) * metersPerLatitudeDegree,
  ]);
  const area = points.reduce((sum, [x1, y1], index) => {
    const [x2, y2] = points[(index + 1) % points.length];
    return sum + x1 * y2 - x2 * y1;
  }, 0);
  return Math.round(Math.abs(area) / 2);
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <ol className={styles.stepIndicator} aria-label="田んぼ登録の進捗">
      {steps.map((step) => {
        const completed = currentStep > step.number;
        const current = currentStep === step.number;
        return (
          <li className={`${current ? styles.currentStep : ""} ${completed ? styles.completedStep : ""}`} key={step.number}>
            <span className={styles.stepCircle} aria-hidden="true">
              {completed ? "✓" : step.number}
            </span>
            <span>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `field-registration-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function FieldRegistrationView({
  initialStep,
  varieties: providedVarieties,
  dataSource: providedSource,
  dataError: providedError,
}: {
  initialStep: number;
  varieties?: RiceVarietyOption[];
  dataSource?: "supabase" | "fixture";
  dataError?: string | null;
}) {
  const varieties = providedVarieties ?? FIXTURE_RICE_VARIETIES;
  const dataSource = providedSource ?? "fixture";
  const dataError = providedError ?? null;
  const router = useRouter();
  const [draft, setDraft] = useState<RegistrationDraft>(() => ({
    ...blankDraft,
    selectionMode: dataSource === "supabase" ? "draw" : "parcel",
  }));
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savePendingRef = useRef(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    let restoreTimer: number | undefined;
    const hydratedTimer = window.setTimeout(() => setHydrated(true), 0);
    if (stored) {
      const parsed = readDraft(stored);
      if (parsed) {
        restoreTimer = window.setTimeout(() => {
          setDraft(parsed);
          setRestored(true);
        }, 0);
      }
    }
    return () => {
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
      if (hydratedTimer !== undefined) window.clearTimeout(hydratedTimer);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || saved) return;
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [draft, hydrated, saved]);

  const selectedParcel = useMemo(
    () =>
      (dataSource === "fixture" ? FIELD_FIXTURES : []).find(
        (field) => field.id === draft.selectedParcelId,
      ),
    [dataSource, draft.selectedParcelId],
  );
  const manualArea = useMemo(() => polygonAreaM2(draft.polygon), [draft.polygon]);
  const areaM2 = selectedParcel?.areaM2 ?? manualArea;
  const hasSelection = draft.selectionMode === "parcel" ? Boolean(selectedParcel) : draft.polygon.length >= 3;
  const selectedVarietyId =
    varieties.some((variety) => variety.id === draft.varietyId)
      ? draft.varietyId
      : varieties.find((variety) => variety.name === draft.variety)?.id || "";

  function goToStep(step: number) {
    router.push(`/app/fields/new/${step}`);
  }

  function chooseMode(mode: SelectionMode) {
    setDraft((current) => ({
      ...current,
      selectionMode: mode,
      selectedParcelId: mode === "draw" ? null : current.selectedParcelId,
    }));
  }

  function chooseParcel(fieldId: string) {
    setDraft((current) => ({
      ...current,
      selectionMode: "parcel",
      selectedParcelId: fieldId,
      polygon: [],
    }));
  }

  function updatePolygon(polygon: Coordinate[]) {
    setDraft((current) => ({ ...current, polygon, selectionMode: "draw", selectedParcelId: null }));
  }

  function discardDraft() {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    setDraft({
      ...blankDraft,
      selectionMode: dataSource === "supabase" ? "draw" : "parcel",
    });
    setRestored(false);
    setSaveError(null);
  }

  async function saveRegistration() {
    if (savePendingRef.current || !hasSelection || !draft.fieldName.trim() || !draft.variety || !selectedVarietyId) {
      return;
    }
    const idempotencyKey = draft.idempotencyKey || createIdempotencyKey();
    savePendingRef.current = true;
    setSavePending(true);
    setSaveError(null);
    setDraft((current) => ({ ...current, idempotencyKey }));

    try {
      const polygon = selectedParcel?.polygon ?? draft.polygon;
      const result = await registerFieldWithSeasonAction({
        idempotencyKey,
        fieldName: draft.fieldName,
        polygon,
        year: 2026,
        varietyId: selectedVarietyId,
        headingDate: draft.headingDate || null,
        parcelSource: selectedParcel ? "MAFF_PARCEL" : "MANUAL",
        parcelExternalId: selectedParcel?.id ?? null,
        parcelDatasetVersion: selectedParcel ? "development-2026" : null,
      });
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      setSaved(true);
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      router.push(`/app/fields/${result.fieldId}`);
    } catch {
      setSaveError("圃場を登録できませんでした。通信状態を確認して再試行してください。");
    } finally {
      savePendingRef.current = false;
      setSavePending(false);
    }
  }

  return (
    <div className={styles.screen}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>NEW FIELD / 2026</p>
          <h1>田んぼを登録</h1>
          <p className={styles.pageLead}>{PILOT_REGION.name}の圃場を登録します。</p>
        </div>
        <Link className={styles.closeLink} href="/app" aria-label="登録をやめて地図へ戻る">
          × 閉じる
        </Link>
      </header>

      <StepIndicator currentStep={initialStep} />

      {restored && (
        <div className={styles.restoreNotice} role="status">
          <span aria-hidden="true">↻</span>
          <div>
            <strong>前回の入力を復元しました</strong>
            <p>画面を閉じても、入力途中の内容は端末内に保存されます。</p>
          </div>
          <button type="button" onClick={discardDraft}>
            破棄
          </button>
        </div>
      )}

      {dataError && <DataLoadError message={dataError} />}
      {dataSource === "fixture" && <FixtureNotice compact />}

      {initialStep === 1 && (
        <section className={styles.panel} aria-labelledby="select-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.stepKicker}>STEP 1 / 3</p>
              <h2 id="select-heading">区画を選ぶ</h2>
            </div>
            <span className={styles.requiredPill}>必須</span>
          </div>
          <p className={styles.helpText}>
            {dataSource === "fixture"
              ? "開発用の筆候補をタップするか、候補にない場合は手描きで区画を囲みます。"
              : "地図上を順番にタップして、圃場の外周を囲みます。"}
          </p>

          <div className={styles.modeTabs} role="group" aria-label="区画の選び方">
            <button className={draft.selectionMode === "parcel" ? styles.modeActive : ""} type="button" onClick={() => chooseMode("parcel")} aria-pressed={draft.selectionMode === "parcel"}>
              <span aria-hidden="true">▦</span>
              筆候補から選ぶ
            </button>
            <button className={draft.selectionMode === "draw" ? styles.modeActive : ""} type="button" onClick={() => chooseMode("draw")} aria-pressed={draft.selectionMode === "draw"}>
              <span aria-hidden="true">⌁</span>
              手描きする
            </button>
          </div>

          <FieldMap
              fields={draft.selectionMode === "parcel" && dataSource === "fixture" ? FIELD_FIXTURES : []}
            selectedId={draft.selectedParcelId}
            onSelect={(field) => chooseParcel(field.id)}
            drawMode={draft.selectionMode === "draw"}
            draftPolygon={draft.polygon}
            onDraftPolygonChange={updatePolygon}
            ariaLabel={draft.selectionMode === "draw" ? "手描き用の地図。タップして点を追加できます。" : "筆候補を選択する地図"}
          />

          {draft.selectionMode === "parcel" && selectedParcel && (
            <div className={styles.selectionSummary} role="status">
              <div>
                <span>選択中の筆候補</span>
                <strong>{selectedParcel.name}</strong>
              </div>
              <span>{selectedParcel.areaM2.toLocaleString("ja-JP")}㎡</span>
            </div>
          )}

          {draft.selectionMode === "draw" && (
            <div className={styles.drawControls}>
              <div className={styles.drawStatus} role="status">
                <span className={styles.pointCount}>{draft.polygon.length}</span>
                <div>
                  <strong>{draft.polygon.length >= 3 ? "区画を囲めます" : "3点以上を追加してください"}</strong>
                  <p>地図上を順番にタップして、田んぼの外周を描きます。</p>
                </div>
              </div>
              <div className={styles.smallActions}>
                <button type="button" onClick={() => updatePolygon(draft.polygon.slice(0, -1))} disabled={draft.polygon.length === 0}>
                  ひとつ戻す
                </button>
                <button type="button" onClick={() => updatePolygon([])} disabled={draft.polygon.length === 0}>
                  クリア
                </button>
              </div>
              {draft.polygon.length >= 3 && (
                <div className={styles.selectionSummary} role="status">
                  <div>
                    <span>手描き区画</span>
                    <strong>点を{draft.polygon.length}個で作成</strong>
                  </div>
                  <span>約{manualArea.toLocaleString("ja-JP")}㎡</span>
                </div>
              )}
            </div>
          )}

          <div className={styles.formActions}>
            <Link className={styles.secondaryAction} href="/app">
              キャンセル
            </Link>
            <button className={styles.primaryAction} type="button" onClick={() => goToStep(2)} disabled={!hasSelection}>
              作付け入力へ <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      {initialStep === 2 && (
        <section className={styles.panel} aria-labelledby="crop-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.stepKicker}>STEP 2 / 3</p>
              <h2 id="crop-heading">作付けを入力</h2>
            </div>
            <span className={styles.progressHint}>{hasSelection ? "区画選択済み" : "区画未選択"}</span>
          </div>
          {!hasSelection && <p className={styles.inlineWarning} role="alert">先に区画を選択してください。</p>}
          <div className={styles.formFields}>
            <label>
              <span>圃場名 <em>必須</em></span>
              <input
                type="text"
                value={draft.fieldName}
                onChange={(event) => setDraft((current) => ({ ...current, fieldName: event.target.value }))}
                placeholder="例：東の田んぼ"
                autoComplete="off"
              />
            </label>
            <label>
              <span>品種 <em>必須</em></span>
              <select
                value={draft.variety}
                onChange={(event) => {
                  const variety = event.target.value as RiceVariety | "";
                  const option = varieties.find((candidate) => candidate.name === variety);
                  setDraft((current) => ({
                    ...current,
                    variety,
                    varietyId: option?.id ?? "",
                  }));
                }}
              >
                <option value="">品種を選択してください</option>
                {varieties.map((variety) => (
                  <option value={variety.name} key={variety.id}>
                    {variety.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>出穂日 <small>任意</small></span>
              <input type="date" value={draft.headingDate} onChange={(event) => setDraft((current) => ({ ...current, headingDate: event.target.value }))} />
              <small>未設定でも登録できます。あとから編集可能です。</small>
            </label>
          </div>
          <div className={styles.ruleCallout} role="note">
            <span className={styles.ruleIcon} aria-hidden="true">i</span>
            <div>
              <strong>適期ルールは登録後に確認します</strong>
              <p>対象地域・品種の公式ルールは未接続です。現在は判定値を設定しません。</p>
            </div>
          </div>
          <div className={styles.formActions}>
            <button className={styles.secondaryAction} type="button" onClick={() => goToStep(1)}>
              <span aria-hidden="true">←</span> 区画選択へ
            </button>
            <button className={styles.primaryAction} type="button" onClick={() => goToStep(3)} disabled={!hasSelection || !draft.fieldName.trim() || !draft.variety || !selectedVarietyId}>
              確認へ <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      {initialStep === 3 && (
        <section className={styles.panel} aria-labelledby="confirm-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.stepKicker}>STEP 3 / 3</p>
              <h2 id="confirm-heading">内容を確認</h2>
            </div>
            <span className={styles.progressHint}>保存前の確認</span>
          </div>
          {(!hasSelection || !draft.fieldName.trim() || !draft.variety || !selectedVarietyId) && (
            <p className={styles.inlineWarning} role="alert">未入力の項目があります。前のステップで確認してください。</p>
          )}
          {saveError && <p className={styles.inlineWarning} role="alert">{saveError}</p>}
          <dl className={styles.confirmList}>
            <div>
              <dt>区画</dt>
              <dd>{selectedParcel ? `${selectedParcel.name}（筆候補）` : `手描き区画（${draft.polygon.length}点）`}</dd>
            </div>
            <div>
              <dt>面積</dt>
              <dd>{areaM2 > 0 ? `${areaM2.toLocaleString("ja-JP")}㎡（概算）` : "—"}</dd>
            </div>
            <div>
              <dt>圃場名</dt>
              <dd>{draft.fieldName || "未入力"}</dd>
            </div>
            <div>
              <dt>品種</dt>
              <dd>{draft.variety || "未選択"}</dd>
            </div>
            <div>
              <dt>出穂日</dt>
              <dd>{draft.headingDate ? formatDate(draft.headingDate) : "未設定"}</dd>
            </div>
            <div>
              <dt>気象地点</dt>
              <dd>久井（候補・開発用）</dd>
            </div>
          </dl>
          <div className={styles.ruleCallout} role="note">
            <span className={styles.ruleIcon} aria-hidden="true">!</span>
            <div>
              <strong>{DEVELOPMENT_RULE.source}</strong>
              <p>公式の品種・地域ルール確認後に適用します。温度の仮値はこの登録には保存しません。</p>
            </div>
          </div>
          <div className={styles.saveCallout}>
            <span aria-hidden="true">✓</span>
            <p>保存直後は「計算中」としてホームに戻ります。初回積算は非同期処理を想定しています。</p>
          </div>
          <div className={styles.formActions}>
            <button className={styles.secondaryAction} type="button" onClick={() => goToStep(2)}>
              <span aria-hidden="true">←</span> 入力へ戻る
            </button>
            <button className={styles.primaryAction} type="button" onClick={saveRegistration} disabled={!hasSelection || !draft.fieldName.trim() || !draft.variety || !selectedVarietyId || savePending}>
              {savePending ? "保存中…" : "保存して詳細へ"} <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      )}

      <p className={styles.footerNote}>
        {dataSource === "fixture"
          ? "入力内容はこの端末の開発用保存領域にのみ保存されます。"
          : "入力途中の内容はこの端末に一時保存され、登録時にSupabaseへ送信されます。"}
      </p>
    </div>
  );
}
