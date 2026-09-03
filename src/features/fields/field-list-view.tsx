"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FixtureNotice, QualityNotice } from "@/components/quality-notice";
import { DataLoadError } from "@/components/data-load-error";
import { StatusBadge } from "@/components/status-badge";
import {
  FIELD_FIXTURES,
  FIELD_STATUS_META,
  formatTemp,
} from "./fixtures";
import type { FieldStatus, FieldViewModel } from "./view-model";
import styles from "./field-list-view.module.css";

const sortOrder: Record<FieldStatus, number> = {
  ready: 0,
  soon: 1,
  overdue: 2,
  growing: 3,
  "not-configured": 4,
  harvested: 5,
};

const filterOptions: Array<{ value: "all" | FieldStatus; label: string }> = [
  { value: "all", label: "すべて" },
  { value: "ready", label: "刈取適期" },
  { value: "soon", label: "接近" },
  { value: "not-configured", label: "未設定" },
];

export function FieldListView({
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
  const [filter, setFilter] = useState<(typeof filterOptions)[number]["value"]>("all");
  const fields = useMemo(
    () =>
      initialFields.filter((field) => filter === "all" || field.status === filter).sort(
        (left, right) => sortOrder[left.status] - sortOrder[right.status],
      ),
    [filter, initialFields],
  );

  return (
    <div className={styles.screen}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>FIELD LIST / 2026</p>
          <h1>田んぼ一覧</h1>
          <p className={styles.pageLead}>刈取適期に近い順に表示しています。</p>
        </div>
        <Link className={styles.addButton} href="/app/fields/new/1">
          <span aria-hidden="true">＋</span>登録
        </Link>
      </header>

      {dataError && <DataLoadError message={dataError} />}
      {dataSource === "fixture" && <FixtureNotice compact />}

      <div className={styles.toolbar}>
        <label>
          <span>表示</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            {filterOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.resultCount}>{fields.length}圃場</span>
      </div>

      <section className={styles.list} aria-label="田んぼ一覧">
        {fields.map((field) => (
          <Link className={styles.card} href={`/app/fields/${field.id}`} key={field.id}>
            <div className={styles.cardHeader}>
              <div>
                <h2>{field.name}</h2>
                <p>{field.variety ?? "品種未設定"}</p>
              </div>
              <StatusBadge status={field.status} />
            </div>
            <div className={styles.cardMetrics}>
              <div>
                <span>積算気温</span>
                <strong>{formatTemp(field.accumulatedTempC)}</strong>
              </div>
              <div>
                <span>{field.remainingTempC !== null && field.remainingTempC < 0 ? "適期超過" : "適期まで"}</span>
                <strong className={field.status === "ready" || field.status === "overdue" ? styles.accentMetric : ""}>
                  {field.remainingTempC !== null && field.remainingTempC < 0
                    ? `${formatTemp(Math.abs(field.remainingTempC))}超過`
                    : formatTemp(field.remainingTempC)}
                </strong>
              </div>
              <div>
                <span>面積</span>
                <strong>{field.areaM2.toLocaleString("ja-JP")}㎡</strong>
              </div>
            </div>
            <QualityNotice
              quality={field.dataQuality}
              observedThrough={field.observedThrough}
              missingDays={field.missingDays}
              compact
            />
            <div className={styles.cardFooter}>
              <span>{FIELD_STATUS_META[field.status].label}の圃場</span>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            </div>
          </Link>
        ))}
      </section>

      <p className={styles.disclaimer}>
        {dataSource === "fixture"
          ? "表示中の状態と温度は開発用フィクスチャです。実際の収穫判断には使用しないでください。"
          : "表示中の状態と温度は補助情報です。実際の収穫判断には使用しないでください。"}
      </p>
    </div>
  );
}
