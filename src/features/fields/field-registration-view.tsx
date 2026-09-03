"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DataLoadError } from "@/components/data-load-error";
import { FixtureNotice } from "@/components/quality-notice";
import { registerFieldWithSeasonAction } from "@/lib/fields/actions";
import type { FieldSizeClass, RiceVarietyOption } from "./view-model";
import { FIXTURE_RICE_VARIETIES } from "./fixtures";
import styles from "./field-registration-view.module.css";

const DRAFT_STORAGE_KEY = "karidoki-navi:simple-field-registration";

type RegistrationDraft = {
  fieldName: string;
  sizeClass: FieldSizeClass;
  varietyId: string;
  plantingDate: string;
  headingDate: string;
  idempotencyKey: string;
};

const blankDraft: RegistrationDraft = {
  fieldName: "",
  sizeClass: "medium",
  varietyId: "",
  plantingDate: "",
  headingDate: "",
  idempotencyKey: "",
};

const sizeOptions: Array<{ value: FieldSizeClass; label: string; description: string }> = [
  { value: "small", label: "小", description: "小さめ" },
  { value: "medium", label: "中", description: "ふつう" },
  { value: "large", label: "大", description: "大きめ" },
];

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `simple-field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readDraft(value: string): RegistrationDraft | null {
  try {
    const draft = JSON.parse(value) as Partial<RegistrationDraft>;
    return {
      fieldName: typeof draft.fieldName === "string" ? draft.fieldName : "",
      sizeClass: ["small", "medium", "large"].includes(draft.sizeClass ?? "")
        ? (draft.sizeClass as FieldSizeClass)
        : "medium",
      varietyId: typeof draft.varietyId === "string" ? draft.varietyId : "",
      plantingDate: typeof draft.plantingDate === "string" ? draft.plantingDate : "",
      headingDate: typeof draft.headingDate === "string" ? draft.headingDate : "",
      idempotencyKey: typeof draft.idempotencyKey === "string" ? draft.idempotencyKey : "",
    };
  } catch {
    return null;
  }
}

export function FieldRegistrationView({
  varieties: providedVarieties,
  dataSource: providedSource,
  dataError: providedError,
}: {
  initialStep?: number;
  varieties?: RiceVarietyOption[];
  dataSource?: "supabase" | "fixture";
  dataError?: string | null;
}) {
  const varieties = providedVarieties ?? FIXTURE_RICE_VARIETIES;
  const dataSource = providedSource ?? "fixture";
  const dataError = providedError ?? null;
  const router = useRouter();
  const [draft, setDraft] = useState<RegistrationDraft>(blankDraft);
  const [restored, setRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savePendingRef = useRef(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    let restoreTimer: number | undefined;
    if (stored) {
      const parsed = readDraft(stored);
      if (parsed) {
        restoreTimer = window.setTimeout(() => {
          setDraft(parsed);
          setRestored(true);
          setHydrated(true);
        }, 0);
        return () => window.clearTimeout(restoreTimer);
      }
    }
    const hydrateTimer = window.setTimeout(() => setHydrated(true), 0);
    return () => window.clearTimeout(hydrateTimer);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [draft, hydrated]);

  function discardDraft() {
    window.localStorage.removeItem(DRAFT_STORAGE_KEY);
    setDraft(blankDraft);
    setRestored(false);
    setSaveError(null);
  }

  async function saveRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePendingRef.current) return;
    if (draft.plantingDate && draft.headingDate && draft.headingDate < draft.plantingDate) {
      setSaveError("出穂日は田植え日より後の日を選んでください。");
      return;
    }

    const idempotencyKey = draft.idempotencyKey || createIdempotencyKey();
    savePendingRef.current = true;
    setSavePending(true);
    setSaveError(null);
    setDraft((current) => ({ ...current, idempotencyKey }));

    try {
      const result = await registerFieldWithSeasonAction({
        idempotencyKey,
        fieldName: draft.fieldName,
        sizeClass: draft.sizeClass,
        year: 2026,
        varietyId: draft.varietyId,
        plantingDate: draft.plantingDate,
        headingDate: draft.headingDate,
      });
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      router.push(`/app/fields/${result.fieldId}`);
    } catch {
      setSaveError("田んぼを登録できませんでした。通信状態を確認して、もう一度お試しください。");
    } finally {
      savePendingRef.current = false;
      setSavePending(false);
    }
  }

  return (
    <div className={styles.screen}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>かんたん登録</p>
          <h1>田んぼを登録</h1>
          <p>場所や細かな面積は入力しません。</p>
        </div>
        <Link className={styles.closeLink} href="/app">戻る</Link>
      </header>

      {restored && (
        <div className={styles.restoreNotice} role="status">
          <div><strong>前回の入力を復元しました</strong><p>続きから入力できます。</p></div>
          <button type="button" onClick={discardDraft}>最初から</button>
        </div>
      )}
      {dataError && <DataLoadError message={dataError} />}
      {dataSource === "fixture" && <FixtureNotice compact />}

      <form className={styles.form} onSubmit={saveRegistration}>
        <label className={styles.field} htmlFor="field-name">
          <span>田んぼの名前 <em>必須</em></span>
          <input id="field-name" type="text" value={draft.fieldName}
            onChange={(event) => setDraft((current) => ({ ...current, fieldName: event.target.value }))}
            placeholder="例：家の前" autoComplete="off" maxLength={100} required />
        </label>

        <fieldset className={styles.sizeField}>
          <legend>田んぼの大きさ <span>必須</span></legend>
          <div className={styles.sizeOptions}>
            {sizeOptions.map((option) => (
              <label className={draft.sizeClass === option.value ? styles.sizeSelected : ""} key={option.value}>
                <input type="radio" name="size-class" value={option.value}
                  checked={draft.sizeClass === option.value}
                  onChange={() => setDraft((current) => ({ ...current, sizeClass: option.value }))} />
                <strong>{option.label}</strong><small>{option.description}</small>
              </label>
            ))}
          </div>
        </fieldset>

        <label className={styles.field} htmlFor="field-variety">
          <span>品種 <em>必須</em></span>
          <select id="field-variety" value={draft.varietyId}
            onChange={(event) => setDraft((current) => ({ ...current, varietyId: event.target.value }))} required>
            <option value="">品種を選んでください</option>
            {varieties.map((variety) => <option value={variety.id} key={variety.id}>{variety.name}</option>)}
          </select>
        </label>

        <div className={styles.dateFields}>
          <label className={styles.field} htmlFor="field-planting-date">
            <span>田植え日 <em>必須</em></span>
            <input id="field-planting-date" type="date" value={draft.plantingDate}
              onChange={(event) => setDraft((current) => ({ ...current, plantingDate: event.target.value }))} required />
          </label>
          <label className={styles.field} htmlFor="field-heading-date">
            <span>出穂日 <em>必須</em></span>
            <input id="field-heading-date" type="date" value={draft.headingDate} min={draft.plantingDate || undefined}
              onChange={(event) => setDraft((current) => ({ ...current, headingDate: event.target.value }))} required />
          </label>
        </div>

        <aside className={styles.helpBox}>
          <span aria-hidden="true">🌡️</span>
          <div><strong>出穂日から自動で計算します</strong><p>登録後は毎日の平均気温を自動で積み上げます。</p></div>
        </aside>
        {saveError && <p className={styles.inlineWarning} role="alert">{saveError}</p>}
        <button className={styles.primaryAction} type="submit"
          disabled={!draft.fieldName.trim() || !draft.varietyId || !draft.plantingDate || !draft.headingDate || savePending}>
          {savePending ? "登録しています…" : "この内容で登録する"}
        </button>
      </form>
      <p className={styles.footerNote}>気温は久井町向けの観測データを自動で使います。</p>
    </div>
  );
}
