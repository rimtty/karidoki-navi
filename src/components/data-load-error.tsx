"use client";

import { useRouter } from "next/navigation";
import styles from "./data-load-error.module.css";

export function DataLoadError({ message }: { message: string }) {
  const router = useRouter();

  return (
    <div className={styles.notice} role="alert" aria-live="assertive">
      <strong>データを表示できません</strong>
      <p>{message}</p>
      <button type="button" onClick={() => router.refresh()}>
        再試行
      </button>
    </div>
  );
}
