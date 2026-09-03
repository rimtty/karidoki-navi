"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DataLoadError } from "@/components/data-load-error";
import { FixtureNotice } from "@/components/quality-notice";
import {
  FIELD_FIXTURES,
  FIELD_STATUS_META,
  formatDate,
  formatTemp,
  type FieldStatus,
} from "./fixtures";
import type { FieldSizeClass, FieldViewModel } from "./view-model";
import styles from "./home-map-view.module.css";

type Filter = "all" | "attention" | "growing" | "harvested";

const statusOrder: Record<FieldStatus, number> = {
  ready: 0,
  overdue: 1,
  soon: 2,
  growing: 3,
  "not-configured": 4,
  harvested: 5,
};

const sizeLabels: Record<FieldSizeClass, string> = {
  small: "小",
  medium: "中",
  large: "大",
};

function needsAttention(field: FieldViewModel): boolean {
  return ["ready", "overdue", "soon", "not-configured"].includes(field.status);
}

function actionMessage(field: FieldViewModel): string {
  if (field.status === "ready") return "今が刈りどきです";
  if (field.status === "overdue") return "早めに確認してください";
  if (field.status === "soon") {
    return field.referenceDays !== null ? `あと約${field.referenceDays}日` : "もうすぐ刈りどきです";
  }
  if (field.status === "growing") return "順調に育っています";
  if (field.status === "harvested") return "収穫済みです";
  return field.headingDate ? "刈りどき設定を確認" : "出穂日を入力してください";
}

function FieldCard({ field }: { field: FieldViewModel }) {
  const meta = FIELD_STATUS_META[field.status];
  return (
    <Link className={`${styles.fieldCard} ${styles[meta.tone]}`} href={`/app/fields/${field.id}`}>
      <div className={styles.cardTopline}>
        <span className={styles.statusLabel}>{meta.label}</span>
        <span className={styles.sizeLabel}>大きさ {sizeLabels[field.sizeClass]}</span>
      </div>
      <div className={styles.cardMain}>
        <div>
          <h2>{field.name}</h2>
          <p>{field.variety ?? "品種未設定"}</p>
        </div>
        <span className={styles.arrow} aria-hidden="true">›</span>
      </div>
      <strong className={styles.actionMessage}>{actionMessage(field)}</strong>
      <div className={styles.cardFacts}>
        <span>出穂日 {formatDate(field.headingDate)}</span>
        <span>積算 {formatTemp(field.accumulatedTempC)}</span>
      </div>
      {field.dataQuality !== "complete" && field.status !== "not-configured" && (
        <p className={styles.dataNotice}>
          {field.dataQuality === "pending" && "気温を計算しています"}
          {field.dataQuality === "incomplete" && "一部の気温データを確認中です"}
          {field.dataQuality === "stale" && "気温データの更新が遅れています"}
          {field.dataQuality === "error" && "気温データを取得できませんでした"}
        </p>
      )}
    </Link>
  );
}

export function HomeMapView({
  initialFields: providedFields,
  dataSource: providedSource,
  dataError: providedError,
}: {
  initialFields?: FieldViewModel[];
  dataSource?: "supabase" | "fixture";
  dataError?: string | null;
}) {
  const initialFields = providedFields ?? FIELD_FIXTURES;
  const dataSource = providedSource ?? "fixture";
  const dataError = providedError ?? null;
  const [filter, setFilter] = useState<Filter>("all");
  const readyCount = initialFields.filter((field) => field.status === "ready").length;
  const attentionCount = initialFields.filter(needsAttention).length;

  const fields = useMemo(() => {
    const filtered = initialFields.filter((field) => {
      if (filter === "attention") return needsAttention(field);
      if (filter === "growing") return field.status === "growing";
      if (filter === "harvested") return field.status === "harvested";
      return true;
    });
    return [...filtered].sort((left, right) => statusOrder[left.status] - statusOrder[right.status]);
  }, [filter, initialFields]);

  return (
    <div className={styles.screen}>
      <header className={styles.pageHeader}>
        <div>
          <p>広島県三原市久井町</p>
          <h1>今日の田んぼ</h1>
          <span>2026年</span>
        </div>
        <Link className={styles.addButton} href="/app/fields/new/1">
          <span aria-hidden="true">＋</span> 登録
        </Link>
      </header>

      {dataError && <DataLoadError message={dataError} />}
      {dataSource === "fixture" && <FixtureNotice compact />}

      <section className={styles.todaySummary} aria-label="今日の刈りどき状況">
        <div>
          <span>今が刈りどき</span>
          <strong>{readyCount}<small>件</small></strong>
        </div>
        <p>{readyCount > 0 ? "上から順に田んぼを確認しましょう。" : "今日は刈りどきの田んぼはありません。"}</p>
      </section>

      <div className={styles.filters} role="group" aria-label="田んぼの表示を切り替える">
        {([
          ["all", "すべて", initialFields.length],
          ["attention", "要確認", attentionCount],
          ["growing", "登熟中", initialFields.filter((field) => field.status === "growing").length],
          ["harvested", "収穫済", initialFields.filter((field) => field.status === "harvested").length],
        ] as const).map(([value, label, count]) => (
          <button key={value} type="button" aria-pressed={filter === value}
            className={filter === value ? styles.filterActive : ""} onClick={() => setFilter(value)}>
            <span>{label}</span><strong>{count}</strong>
          </button>
        ))}
      </div>

      <section className={styles.fieldList} aria-label="田んぼ一覧">
        <div className={styles.listHeading}>
          <h2>刈る順に表示</h2>
          <span>{fields.length}件</span>
        </div>
        {fields.length > 0 ? fields.map((field) => <FieldCard field={field} key={field.id} />) : (
          <div className={styles.emptyState}>
            <span aria-hidden="true">🌾</span>
            <strong>表示する田んぼがありません</strong>
            <p>「登録」から田んぼを追加できます。</p>
          </div>
        )}
      </section>

      <p className={styles.disclaimer}>刈りどきは目安です。稲の状態や天候も確認してください。</p>
    </div>
  );
}
