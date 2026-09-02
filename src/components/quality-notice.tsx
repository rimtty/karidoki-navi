import {
  DATA_QUALITY_META,
  formatDate,
} from "@/features/fields/fixtures";
import type { DataQuality } from "@/features/fields/view-model";
import { QualityBadge } from "./status-badge";
import styles from "./quality-notice.module.css";

export function QualityNotice({
  quality,
  observedThrough,
  missingDays,
  compact = false,
}: {
  quality: DataQuality;
  observedThrough: string | null;
  missingDays: number;
  compact?: boolean;
}) {
  const meta = DATA_QUALITY_META[quality];
  const isAlert = quality === "incomplete" || quality === "stale" || quality === "error";
  const detail =
    quality === "incomplete" && missingDays > 0
      ? `欠測 ${missingDays}日。積算値は参考表示です。`
      : quality === "stale" && observedThrough
        ? `${formatDate(observedThrough)}以降の更新がありません。`
        : quality === "error"
          ? "再取得まで前回の値を表示しています。"
          : meta.message;

  return (
    <div
      className={`${styles.notice} ${styles[meta.tone]} ${compact ? styles.compact : ""}`}
      role={isAlert ? "alert" : "status"}
    >
      <div className={styles.noticeHeader}>
        <QualityBadge quality={quality} />
        {observedThrough && (
          <span className={styles.updated}>反映済み {formatDate(observedThrough)}</span>
        )}
      </div>
      <p>{detail}</p>
    </div>
  );
}

export function FixtureNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${styles.fixture} ${compact ? styles.compact : ""}`} role="note">
      <span className={styles.fixtureMark} aria-hidden="true">
        DEV
      </span>
      <p>
        開発用フィクスチャを表示中。圃場・気象・適期ルールは本番データに未接続です。
      </p>
    </div>
  );
}
