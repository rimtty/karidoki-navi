"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FieldMap } from "./field-map";
import {
  FIELD_FIXTURES,
  FIELD_STATUS_META,
  PILOT_REGION,
  formatDate,
  formatTemp,
  type FieldFixture,
  type FieldStatus,
} from "./fixtures";
import { FixtureNotice, QualityNotice } from "@/components/quality-notice";
import { StatusBadge } from "@/components/status-badge";
import styles from "./home-map-view.module.css";

type Filter = "all" | FieldStatus;

const filterOptions: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "すべて" },
  { key: "ready", label: "適期" },
  { key: "soon", label: "接近" },
  { key: "not-configured", label: "未設定" },
];

function countFor(status: FieldStatus): number {
  return FIELD_FIXTURES.filter((field) => field.status === status).length;
}

function FieldSheet({ field, onClose }: { field: FieldFixture; onClose: () => void }) {
  return (
    <section className={styles.sheet} aria-label={`${field.name}の概要`} aria-live="polite">
      <div className={styles.sheetHandle} aria-hidden="true" />
      <div className={styles.sheetHeading}>
        <div>
          <p className={styles.sheetKicker}>選択中の圃場</p>
          <h2>{field.name}</h2>
          <p className={styles.sheetSubline}>{field.variety ?? "品種未設定"}</p>
        </div>
        <div className={styles.sheetHeadingActions}>
          <StatusBadge status={field.status} />
          <button className={styles.closeButton} type="button" onClick={onClose} aria-label="圃場の選択を閉じる">
            ×
          </button>
        </div>
      </div>
      <div className={styles.sheetMetrics}>
        <div>
          <span>出穂後積算</span>
          <strong>{formatTemp(field.accumulatedTempC)}</strong>
        </div>
        <div>
          <span>{field.remainingTempC !== null && field.remainingTempC < 0 ? "適期から" : "適期まで"}</span>
          <strong className={field.remainingTempC !== null && field.remainingTempC <= 0 ? styles.metricEmphasis : ""}>
            {field.remainingTempC !== null && field.remainingTempC < 0
              ? formatTemp(Math.abs(field.remainingTempC))
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
      <div className={styles.sheetFooter}>
        <span className={styles.stationLabel}>
          観測地点: {field.weatherStation ?? "未設定"}
        </span>
        <Link className={styles.detailLink} href={`/app/fields/${field.id}`}>
          詳しく見る <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}

export function HomeMapView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [registrationMessage, setRegistrationMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("karidoki-navi:last-registration");
    if (!stored) return;
    let messageTimer: number | undefined;
    try {
      const registration = JSON.parse(stored) as { name?: string };
      messageTimer = window.setTimeout(() => {
        setRegistrationMessage(
          registration.name
            ? `${registration.name}を登録しました。初回計算は準備中です。`
            : "田んぼを登録しました。初回計算は準備中です。",
        );
      }, 0);
      window.localStorage.removeItem("karidoki-navi:last-registration");
    } catch {
      window.localStorage.removeItem("karidoki-navi:last-registration");
    }
    return () => {
      if (messageTimer !== undefined) window.clearTimeout(messageTimer);
    };
  }, []);

  const visibleFields = useMemo(
    () => (filter === "all" ? FIELD_FIXTURES : FIELD_FIXTURES.filter((field) => field.status === filter)),
    [filter],
  );
  const selectedField = selectedId ? visibleFields.find((field) => field.id === selectedId) : undefined;

  return (
    <div className={styles.screen}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{PILOT_REGION.name}</p>
          <h1>今日の刈りどき</h1>
          <label className={styles.yearLabel}>
            <span>年度</span>
            <select defaultValue="2026" aria-label="表示する年度">
              <option value="2026">2026年</option>
              <option value="2025">2025年</option>
            </select>
          </label>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryAction} href="/app/fields">
            一覧
          </Link>
          <Link className={styles.primaryAction} href="/app/fields/new/1">
            <span aria-hidden="true">＋</span>田んぼ登録
          </Link>
        </div>
      </header>

      {registrationMessage && (
        <div className={styles.registrationMessage} role="status">
          <span aria-hidden="true">✓</span>
          <span>{registrationMessage}</span>
          <button type="button" onClick={() => setRegistrationMessage(null)} aria-label="登録メッセージを閉じる">
            ×
          </button>
        </div>
      )}

      <FixtureNotice />

      <section className={styles.statusSection} aria-labelledby="status-heading">
        <div className={styles.sectionTitleRow}>
          <div>
            <p className={styles.sectionKicker}>FIELD STATUS</p>
            <h2 id="status-heading">田んぼの状態</h2>
          </div>
          <span className={styles.updatedAt}>最終更新 {formatDate("2026-09-02")}</span>
        </div>
        <div className={styles.filters} role="group" aria-label="状態で絞り込む">
          {filterOptions.map((option) => {
            const count = option.key === "all" ? FIELD_FIXTURES.length : countFor(option.key);
            const active = filter === option.key;
            return (
              <button
                className={`${styles.filterButton} ${active ? styles.filterActive : ""}`}
                type="button"
                key={option.key}
                onClick={() => {
                  setFilter(option.key);
                  setSelectedId(null);
                }}
                aria-pressed={active}
              >
                <span>{option.label}</span>
                <strong>{count}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.mapSection} aria-labelledby="map-heading">
        <div className={styles.sectionTitleRow}>
          <div>
            <p className={styles.sectionKicker}>FIELD MAP</p>
            <h2 id="map-heading">圃場マップ</h2>
          </div>
          <span className={styles.mapInstruction}>区画をタップ</span>
        </div>
        <FieldMap
          fields={visibleFields}
          selectedId={selectedId}
          onSelect={(field) => setSelectedId(field.id)}
          ariaLabel="開発用圃場マップ。圃場を選択できます。"
        />
        <div className={styles.legend} aria-label="状態の凡例">
          {(["ready", "soon", "growing", "overdue", "not-configured"] as FieldStatus[]).map((status) => (
            <span key={status}>
              <i className={`${styles.legendSwatch} ${styles[FIELD_STATUS_META[status].tone]}`} aria-hidden="true" />
              {FIELD_STATUS_META[status].label}
            </span>
          ))}
        </div>
      </section>

      {selectedField ? (
        <FieldSheet field={selectedField} onClose={() => setSelectedId(null)} />
      ) : (
        <div className={styles.emptySheet} role="status">
          <span className={styles.emptySheetIcon} aria-hidden="true">
            ⌖
          </span>
          <div>
            <strong>圃場をタップすると詳細が開きます</strong>
            <p>色だけでなく、状態ラベルと残り温度でも確認できます。</p>
          </div>
        </div>
      )}

      <div className={styles.mapFootnote}>
        <span>地理院タイルを使用</span>
        <span>収穫の判断は現地の状況とあわせて行ってください。</span>
      </div>
    </div>
  );
}
