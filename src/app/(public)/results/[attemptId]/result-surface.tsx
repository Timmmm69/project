"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { AuthenticResultSummary } from "./result-view-model";
import styles from "./result.module.css";

type RetrySurfaceProps = Readonly<{
  onRetry: () => void;
  retrying: boolean;
}>;

export function AuthenticResultSurface({ summary }: Readonly<{ summary: AuthenticResultSummary }>) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const status = summary.status === "expired"
    ? "Статус: время истекло"
    : "Статус: завершено вручную";

  return (
    <section aria-labelledby="authentic-result-heading" className={styles.surface}>
      <h1 className={styles.heading} id="authentic-result-heading" ref={headingRef} tabIndex={-1}>
        Результат попытки
      </h1>
      <p className={styles.status}>{status}</p>
      <p className={styles.status}>Завершено: {summary.completedAt}</p>

      <div
        aria-label={`Общий первичный результат: ${summary.primaryScore} из ${summary.primaryMax}`}
        className={styles.total}
        data-result-block="total"
        role="group"
      >
        <p aria-hidden="true" className={styles.totalLabel}>Общий первичный результат</p>
        <p aria-hidden="true" className={styles.totalScore} data-result-value="total">
          {summary.primaryScore} из {summary.primaryMax}
        </p>
      </div>

      <div className={styles.parts}>
        <div className={styles.part} data-result-block="part-a">
          <p className={styles.partScore}>Part A: {summary.partA.score} из {summary.partA.maxScore}</p>
        </div>
        <div className={styles.part} data-result-block="part-b">
          <p className={styles.partScore}>Part B: {summary.partB.score} из {summary.partB.maxScore}</p>
        </div>
      </div>

      <p className={styles.explanation}>
        Это первичный результат этой тренировочной попытки. Он не является прогнозом результата ЦЭ или ЦТ.
      </p>

      <Link className={styles.catalogAction} href="/">
        Вернуться в каталог
      </Link>
    </section>
  );
}

export function ResultLoadingSurface() {
  return (
    <section aria-live="polite" className={styles.stateSurface} role="status">
      <p className={styles.stateCopy}>Загружаем результат…</p>
    </section>
  );
}

export function ResultTemporaryErrorSurface({ onRetry, retrying }: RetrySurfaceProps) {
  return (
    <section aria-labelledby="result-error-heading" className={styles.stateSurface} role="alert">
      <h1 className={styles.stateHeading} id="result-error-heading">Результат попытки</h1>
      <p className={styles.stateCopy}>
        Не удалось загрузить результат. Попытка не будет завершена повторно. Повторите загрузку.
      </p>
      <button className={styles.retryAction} disabled={retrying} onClick={onRetry} type="button">
        Повторить загрузку
      </button>
    </section>
  );
}

export function ResultNotReadySurface({ onRetry, retrying }: RetrySurfaceProps) {
  return (
    <section aria-labelledby="result-not-ready-heading" className={styles.stateSurface}>
      <h1 className={styles.stateHeading} id="result-not-ready-heading">Результат попытки</h1>
      <p className={styles.stateCopy} role="status">
        Результат ещё не готов. Повторное завершение не требуется.
      </p>
      <button className={styles.retryAction} disabled={retrying} onClick={onRetry} type="button">
        Повторить загрузку
      </button>
    </section>
  );
}
