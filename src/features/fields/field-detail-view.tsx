"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FieldMap } from "./field-map";
import {
  FIELD_STATUS_META,
  formatDate,
  formatTemp,
  type FieldFixture,
} from "./fixtures";
import { FixtureNotice, QualityNotice } from "@/components/quality-notice";
import { StatusBadge } from "@/components/status-badge";
import styles from "./field-detail-view.module.css";

function AccumulationChart({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);

  return (
    <div className={styles.chart} role="img" aria-label="出穂後積算気温の推移（開発用フィクスチャ）">
      <div className={styles.chartGrid} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className={styles.bars}>
        {values.map((value, index) => (
          <div className={styles.barColumn} key={`${value}-${index}`}>
            <div className={styles.barTrack}>
              <div className={styles.bar} style={{ height: `${Math.max((value / max) * 100, 4)}%` }} />
            </div>
            <span>{index + 1}</span>
          </div>
        ))}
      </div>
      <div className={styles.chartAxis}>
        <span>出穂後日数</span>
        <span>累計（℃）</span>
      </div>
    </div>
  );
}

export function FieldDetailView({ field }: { field: FieldFixture }) {
  const [showHarvest, setShowHarvest] = useState(false);
  const [harvestDate, setHarvestDate] = useState("2026-09-03");
  const [harvested, setHarvested] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rule = field.rule;
  const chartValues = field.dailyAccumulation;
  const statusMeta = FIELD_STATUS_META[field.status];
  const detailSummary = useMemo(() => {
    if (field.status === "not-configured") return "出穂日・品種を登録すると積算を開始します。";
    if (field.status === "overdue") return "適期終了温度を超えています。現地の状態を確認してください。";
    if (field.status === "ready") return "適期の範囲内です。現地の状態とあわせて収穫時期を判断してください。";
    if (field.status === "soon") return "適期開始に近づいています。直近の気温傾向は参考値です。";
    return "登熟中です。積算値は目安として確認してください。";
  }, [field.status]);

  function registerHarvest() {
    if (!harvestDate) return;
    window.localStorage.setItem(
      `karidoki-navi:harvested:${field.id}`,
      JSON.stringify({ harvestDate, accumulatedTempC: field.accumulatedTempC }),
    );
    setHarvested(true);
    setShowHarvest(false);
    setNotice(`${formatDate(harvestDate)}の収穫を記録しました。`);
  }

  return (
    <div className={styles.screen}>
      <div className={styles.breadcrumbs}>
        <Link href="/app">地図</Link>
        <span aria-hidden="true">/</span>
        <Link href="/app/fields">田んぼ一覧</Link>
        <span aria-hidden="true">/</span>
        <span>{field.name}</span>
      </div>

      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>FIELD DETAIL</p>
          <h1>{field.name}</h1>
          <p className={styles.subline}>{field.variety ?? "品種未設定"}</p>
        </div>
        <StatusBadge status={harvested ? "harvested" : field.status} />
      </header>

      <FixtureNotice />

      {notice && (
        <div className={styles.successNotice} role="status">
          <span aria-hidden="true">✓</span>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="通知を閉じる">
            ×
          </button>
        </div>
      )}

      <section className={`${styles.statusCard} ${styles[statusMeta.tone]}`} aria-labelledby="current-status">
        <div className={styles.statusCardHeading}>
          <div>
            <p className={styles.cardKicker}>CURRENT STATUS</p>
            <h2 id="current-status">{statusMeta.label}</h2>
          </div>
          <span className={styles.statusGlyph} aria-hidden="true">
            {statusMeta.glyph}
          </span>
        </div>
        <p className={styles.statusSummary}>{detailSummary}</p>
        <div className={styles.bigMetrics}>
          <div>
            <span>現在の積算気温</span>
            <strong>{formatTemp(field.accumulatedTempC)}</strong>
          </div>
          <div>
            <span>{field.remainingTempC !== null && field.remainingTempC < 0 ? "適期終了から" : "適期開始まで"}</span>
            <strong>
              {field.remainingTempC !== null && field.remainingTempC < 0
                ? `${formatTemp(Math.abs(field.remainingTempC))}超過`
                : formatTemp(field.remainingTempC)}
            </strong>
          </div>
          <div>
            <span>参考残り日数</span>
            <strong>{field.referenceDays !== null ? `約${field.referenceDays}日` : "表示なし"}</strong>
          </div>
        </div>
        {field.referenceDays !== null && (
          <p className={styles.referenceNote}>直近の気温傾向による参考値。天気予報ではありません。</p>
        )}
      </section>

      <QualityNotice
        quality={field.dataQuality}
        observedThrough={field.observedThrough}
        missingDays={field.missingDays}
      />

      <section className={styles.panel} aria-labelledby="rule-heading">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.cardKicker}>APPLIED RULE</p>
            <h2 id="rule-heading">適用ルール</h2>
          </div>
          <span className={styles.devPill}>開発用</span>
        </div>
        {rule ? (
          <>
            <div className={styles.ruleGrid}>
              <div>
                <span>適期開始</span>
                <strong>{formatTemp(rule.startTempC)}</strong>
              </div>
              <div>
                <span>適期中心</span>
                <strong>{formatTemp(rule.targetTempC)}</strong>
              </div>
              <div>
                <span>適期終了</span>
                <strong>{formatTemp(rule.endTempC)}</strong>
              </div>
            </div>
            <div className={styles.ruleWarning} role="note">
              <strong>{rule.label}</strong>
              <span>{rule.source}。本番の営農判断には使用しないでください。</span>
            </div>
          </>
        ) : (
          <div className={styles.unconfiguredRule}>
            <strong>公式ルール未設定</strong>
            <span>対象地域・品種の根拠を確認後に適用します。</span>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="metadata-heading">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.cardKicker}>DATA SOURCES</p>
            <h2 id="metadata-heading">登録・データ情報</h2>
          </div>
        </div>
        <dl className={styles.metadata}>
          <div>
            <dt>面積</dt>
            <dd>{field.areaM2.toLocaleString("ja-JP")}㎡</dd>
          </div>
          <div>
            <dt>出穂日</dt>
            <dd>{formatDate(field.headingDate)}</dd>
          </div>
          <div>
            <dt>積算開始日</dt>
            <dd>{formatDate(field.accumulationStartDate)}</dd>
          </div>
          <div>
            <dt>観測地点</dt>
            <dd>{field.weatherStation ?? "未設定"}</dd>
          </div>
          <div>
            <dt>反映済み日</dt>
            <dd>{formatDate(field.observedThrough)}</dd>
          </div>
          <div>
            <dt>データ品質</dt>
            <dd>{field.dataQuality === "complete" ? "対象期間の値あり" : "要確認"}</dd>
          </div>
        </dl>
      </section>

      {chartValues.length > 0 && (
        <section className={styles.panel} aria-labelledby="chart-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.cardKicker}>ACCUMULATION</p>
              <h2 id="chart-heading">日別積算グラフ</h2>
            </div>
            <span className={styles.chartCaption}>開発用表示</span>
          </div>
          <AccumulationChart values={chartValues} />
        </section>
      )}

      <section className={styles.mapPanel} aria-labelledby="location-heading">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.cardKicker}>LOCATION</p>
            <h2 id="location-heading">圃場の位置</h2>
          </div>
        </div>
        <FieldMap fields={[field]} selectedId={field.id} ariaLabel={`${field.name}の位置`} className={styles.detailMap} />
      </section>

      <section className={styles.actions} aria-label="圃場の操作">
        <Link className={styles.secondaryAction} href="/app/fields/new/2">
          作付けを編集
        </Link>
        <button className={styles.secondaryAction} type="button" onClick={() => setNotice("観測地点の変更は準備中です。現在は開発用地点を表示しています。")}>
          観測地点を変更
        </button>
        <button className={styles.primaryAction} type="button" onClick={() => setShowHarvest(true)} disabled={harvested}>
          {harvested ? "収穫記録済み" : "収穫を登録"}
        </button>
      </section>

      {showHarvest && (
        <div className={styles.harvestPanel} role="dialog" aria-modal="true" aria-labelledby="harvest-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.cardKicker}>HARVEST RECORD</p>
              <h2 id="harvest-heading">収穫を登録</h2>
            </div>
            <button className={styles.panelClose} type="button" onClick={() => setShowHarvest(false)} aria-label="収穫登録を閉じる">
              ×
            </button>
          </div>
          <p className={styles.harvestHelp}>収穫日と、その時点の積算値を履歴として保存します。</p>
          <label className={styles.dateField}>
            <span>収穫日</span>
            <input type="date" value={harvestDate} onChange={(event) => setHarvestDate(event.target.value)} />
          </label>
          <div className={styles.harvestPreview}>
            <span>収穫時積算気温</span>
            <strong>{formatTemp(field.accumulatedTempC)}</strong>
          </div>
          <div className={styles.harvestActions}>
            <button className={styles.secondaryAction} type="button" onClick={() => setShowHarvest(false)}>
              キャンセル
            </button>
            <button className={styles.primaryAction} type="button" onClick={registerHarvest} disabled={!harvestDate}>
              登録する
            </button>
          </div>
        </div>
      )}

      <p className={styles.disclaimer}>成熟状態は補助情報です。圃場の状態、乾燥条件、地域の指針なども確認してください。</p>
    </div>
  );
}
