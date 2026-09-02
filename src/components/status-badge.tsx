import {
  DATA_QUALITY_META,
  FIELD_STATUS_META,
} from "@/features/fields/fixtures";
import type { DataQuality, FieldStatus } from "@/features/fields/view-model";
import styles from "./status-badge.module.css";

export function StatusBadge({ status }: { status: FieldStatus }) {
  const meta = FIELD_STATUS_META[status];

  return (
    <span className={`${styles.badge} ${styles[meta.tone]}`}>
      <span className={styles.glyph} aria-hidden="true">
        {meta.glyph}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}

export function QualityBadge({ quality }: { quality: DataQuality }) {
  const meta = DATA_QUALITY_META[quality];

  return (
    <span className={`${styles.qualityBadge} ${styles[meta.tone]}`}>
      <span className={styles.qualityDot} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
