"use client";

import { useRouter } from "next/navigation";
import styles from "./catalog.module.css";

export function CatalogRetryButton() {
  const router = useRouter();

  return (
    <button className={styles.retryButton} onClick={() => router.refresh()} type="button">
      Повторить
    </button>
  );
}
