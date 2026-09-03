"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DataLoadError } from "@/components/data-load-error";
import { FixtureNotice, QualityNotice } from "@/components/quality-notice";
import { registerHarvestAction } from "@/lib/fields/actions";
import { FIELD_STATUS_META, formatDate, formatTemp } from "./fixtures";
import type { FieldSizeClass, FieldViewModel } from "./view-model";
import styles from "./field-detail-view.module.css";

const sizeLabels: Record<FieldSizeClass, string> = { small: "小", medium: "中", large: "大" };

function FieldDetailContent({ field, dataSource }: { field: FieldViewModel; dataSource: "supabase" | "fixture" }) {
  const router = useRouter();
  const [showHarvest, setShowHarvest] = useState(false);
  const [harvestDate, setHarvestDate] = useState(field.harvestDate ?? "2026-09-03");
  const [harvested, setHarvested] = useState(Boolean(field.harvestDate));
  const [notice, setNotice] = useState<string | null>(null);
  const [harvestError, setHarvestError] = useState<string | null>(null);
  const [harvestPending, setHarvestPending] = useState(false);
  const harvestButtonRef = useRef<HTMLButtonElement | null>(null);
  const harvestPanelRef = useRef<HTMLDivElement | null>(null);
  const harvestCloseRef = useRef<HTMLButtonElement | null>(null);
  const harvestDateRef = useRef<HTMLInputElement | null>(null);
  const harvestPendingRef = useRef(false);
  const dialogWasOpen = useRef(false);
  const status = harvested ? "harvested" : field.status;
  const statusMeta = FIELD_STATUS_META[status];

  const summary = useMemo(() => {
    if (status === "harvested") return "この田んぼは収穫済みです。";
    if (status === "ready") return "今が刈りどきです。稲と天候を確認しましょう。";
    if (status === "overdue") return "刈りどきを過ぎています。早めに田んぼを確認してください。";
    if (status === "soon") return field.referenceDays !== null ? `刈りどきまで、あと約${field.referenceDays}日です。` : "刈りどきが近づいています。";
    if (status === "growing") return "順調に登熟しています。";
    return "この品種の刈りどき設定を確認してください。";
  }, [field.referenceDays, status]);

  useEffect(() => {
    if (showHarvest) {
      window.setTimeout(() => harvestDateRef.current?.focus(), 0);
    } else if (dialogWasOpen.current) {
      harvestButtonRef.current?.focus();
    }
    dialogWasOpen.current = showHarvest;
  }, [showHarvest]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!showHarvest || !harvestPanelRef.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setShowHarvest(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(harvestPanelRef.current.querySelectorAll<HTMLElement>("button, input, [href], [tabindex]:not([tabindex='-1'])"))
      .filter((element) => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function registerHarvest() {
    if (!harvestDate || harvestPendingRef.current) return;
    harvestPendingRef.current = true;
    setHarvestPending(true);
    setHarvestError(null);
    try {
      if (dataSource === "supabase") {
        if (!field.seasonId) {
          setHarvestError("この年の作付けが見つかりません。");
          return;
        }
        const result = await registerHarvestAction({ cropSeasonId: field.seasonId, harvestDate, accumulatedTempC: field.accumulatedTempC });
        if (!result.ok) { setHarvestError(result.message); return; }
      }
      setHarvested(true);
      setShowHarvest(false);
      setNotice(`${formatDate(harvestDate)}の収穫を記録しました。`);
      if (dataSource === "supabase") router.refresh();
    } catch {
      setHarvestError("収穫を登録できませんでした。もう一度お試しください。");
    } finally {
      harvestPendingRef.current = false;
      setHarvestPending(false);
    }
  }

  return (
    <div className={styles.screen}>
      <Link className={styles.backLink} href="/app">‹ 田んぼ一覧へ</Link>
      <header className={styles.pageHeader}>
        <div><p>田んぼの詳細</p><h1>{field.name}</h1><span>{field.variety ?? "品種未設定"}・大きさ {sizeLabels[field.sizeClass]}</span></div>
      </header>
      {dataSource === "fixture" && <FixtureNotice compact />}
      {notice && <div className={styles.successNotice} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="通知を閉じる">×</button></div>}

      <section className={`${styles.statusCard} ${styles[statusMeta.tone]}`}>
        <span className={styles.statusLabel}>{statusMeta.label}</span>
        <h2>{summary}</h2>
        <div className={styles.mainMetric}><span>出穂後の積算気温</span><strong>{formatTemp(field.accumulatedTempC)}</strong></div>
        {field.referenceDays !== null && status === "soon" && <p className={styles.days}>あと約 {field.referenceDays} 日</p>}
      </section>

      <QualityNotice quality={field.dataQuality} observedThrough={field.observedThrough} missingDays={field.missingDays} compact />

      <section className={styles.infoPanel}>
        <h2>登録内容</h2>
        <dl>
          <div><dt>田んぼの大きさ</dt><dd>{sizeLabels[field.sizeClass]}</dd></div>
          <div><dt>品種</dt><dd>{field.variety ?? "未設定"}</dd></div>
          <div><dt>田植え日</dt><dd>{formatDate(field.plantingDate)}</dd></div>
          <div><dt>出穂日</dt><dd>{formatDate(field.headingDate)}</dd></div>
          <div><dt>気温の反映</dt><dd>{formatDate(field.observedThrough)}まで</dd></div>
        </dl>
      </section>

      {status === "not-configured" && (
        <aside className={styles.settingNotice}>
          <div><strong>刈りどきの基準が未設定です</strong><p>品種に合わせた積算気温の基準を設定してください。</p></div>
          <Link href="/app/settings/variety-rules">設定を見る</Link>
        </aside>
      )}

      <button ref={harvestButtonRef} className={styles.harvestButton} type="button" onClick={() => setShowHarvest(true)} disabled={harvested}>
        {harvested ? "収穫を記録済み" : "この田んぼの収穫を記録"}
      </button>

      {showHarvest && (
        <div className={styles.dialogBackdrop}>
          <div ref={harvestPanelRef} className={styles.harvestPanel} role="dialog" aria-modal="true" aria-labelledby="harvest-heading" onKeyDown={handleDialogKeyDown}>
            <div className={styles.dialogHeading}><h2 id="harvest-heading">収穫日を記録</h2><button ref={harvestCloseRef} type="button" onClick={() => setShowHarvest(false)} aria-label="閉じる">×</button></div>
            <p>この田んぼを収穫した日を選んでください。</p>
            {harvestError && <p className={styles.inlineWarning} role="alert">{harvestError}</p>}
            <label htmlFor="harvest-date"><span>収穫日</span><input ref={harvestDateRef} id="harvest-date" type="date" value={harvestDate} onChange={(event) => setHarvestDate(event.target.value)} /></label>
            <div className={styles.dialogActions}><button type="button" onClick={() => setShowHarvest(false)}>やめる</button><button type="button" onClick={registerHarvest} disabled={!harvestDate || harvestPending}>{harvestPending ? "記録しています…" : "記録する"}</button></div>
          </div>
        </div>
      )}
      <p className={styles.disclaimer}>刈りどきは目安です。稲の状態や天候も確認してください。</p>
    </div>
  );
}

export function FieldDetailView({ field, dataSource: providedSource, dataError: providedError }: {
  field: FieldViewModel | null;
  dataSource?: "supabase" | "fixture";
  dataError?: string | null;
}) {
  if (!field) return <div className={styles.screen}><DataLoadError message={providedError ?? "田んぼが見つかりません。"} /></div>;
  return <FieldDetailContent field={field} dataSource={providedSource ?? "fixture"} />;
}
