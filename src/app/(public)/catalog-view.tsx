import type { ReactNode } from "react";
import Link from "next/link";
import type { PublicTest } from "@/lib/public-tests/serialize";
import styles from "./catalog.module.css";

export type CatalogTest = Pick<
  PublicTest,
  | "id"
  | "title"
  | "slug"
  | "mode"
  | "shortDescription"
  | "price"
  | "currency"
  | "durationMinutes"
  | "attemptsLimit"
  | "questionsCount"
  | "maxRawScore"
  | "showScaledScore"
>;

type CatalogViewProps =
  | Readonly<{ state: "success"; tests: readonly CatalogTest[] }>
  | Readonly<{ state: "empty" }>
  | Readonly<{ state: "error"; retryControl: ReactNode }>;

function formatPrice(price: number, currency: string) {
  const amount = price / 100;
  const formattedAmount = Number.isInteger(amount)
    ? String(amount)
    : amount.toFixed(2).replace(".", ",");
  return `${formattedAmount} ${currency}`;
}

function formatAttempts(attempts: number) {
  const mod100 = attempts % 100;
  const mod10 = attempts % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? "попыток"
    : mod10 === 1
      ? "попытка"
      : mod10 >= 2 && mod10 <= 4
        ? "попытки"
        : "попыток";
  return `${attempts} ${noun}`;
}

export function isAuthenticTrainingTest(test: CatalogTest) {
  return test.mode === "ce_ct"
    && test.questionsCount === 40
    && test.durationMinutes === 120
    && test.attemptsLimit === 1
    && test.maxRawScore === 80
    && test.showScaledScore === false;
}

function ProductCard({ test }: Readonly<{ test: CatalogTest }>) {
  const authentic = isAuthenticTrainingTest(test);
  const productUrl = `/tests/${test.slug}`;

  return (
    <article className={styles.card} data-catalog-kind={authentic ? "authentic" : "generic"}>
      <div className={styles.cardHeader}>
        {authentic ? <p className={styles.badge}>Оригинальный тренировочный вариант</p> : null}
        <h2 className={styles.cardTitle}>{test.title}</h2>
        <p className={styles.availability}>
          <span aria-hidden="true" className={styles.availabilityDot} />
          Доступен для покупки
        </p>
      </div>

      <ul aria-label="Основные характеристики теста" className={styles.facts}>
        <li>{test.questionsCount} заданий</li>
        <li>{test.durationMinutes} минут</li>
        <li>{authentic ? "Одна покупка — одна попытка" : formatAttempts(test.attemptsLimit)}</li>
        {!test.showScaledScore ? <li>Только первичный результат</li> : null}
      </ul>

      <div className={styles.purchase}>
        <p className={styles.price}>{formatPrice(test.price, test.currency)}</p>
        <Link className={styles.primaryAction} href={productUrl}>
          Подробнее о тесте
        </Link>
        <Link className={styles.secondaryAction} href={productUrl}>
          Уже есть доступ?
        </Link>
      </div>

      {test.shortDescription ? <p className={styles.description}>{test.shortDescription}</p> : null}

      {authentic ? (
        <p className={styles.disclaimer}>Не является официальным материалом ЦЭ/ЦТ.</p>
      ) : null}
    </article>
  );
}

export function CatalogLoading() {
  return (
    <section aria-label="Загружается каталог тестов" aria-live="polite" className={styles.loadingSurface} role="status">
      <p className={styles.stateLabel}>Загружаем тесты…</p>
      <div aria-hidden="true" className={styles.skeleton}>
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

export function CatalogView(props: CatalogViewProps) {
  if (props.state === "empty") {
    return (
      <section className={styles.stateSurface}>
        <h2 className={styles.stateTitle}>Сейчас нет доступных тестов</h2>
        <p className={styles.stateDescription}>Покупка недоступна. Можно вернуться позже.</p>
      </section>
    );
  }

  if (props.state === "error") {
    return (
      <section className={`${styles.stateSurface} ${styles.errorSurface}`} role="alert">
        <h2 className={styles.stateTitle}>Не удалось загрузить каталог</h2>
        <p className={styles.stateDescription}>Данные о тестах не изменены. Повторите загрузку.</p>
        {props.retryControl}
      </section>
    );
  }

  return (
    <section aria-label="Доступные тесты" className={styles.catalogList}>
      {props.tests.map((test) => <ProductCard key={test.id} test={test} />)}
    </section>
  );
}
