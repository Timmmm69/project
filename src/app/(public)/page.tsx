import Link from "next/link";
import { Suspense } from "react";
import { CatalogContent } from "./catalog-content";
import { CatalogLoading } from "./catalog-view";
import styles from "./catalog.module.css";

export const dynamic = "force-dynamic";

export default function PublicCatalogPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <Link aria-label="Русский язык. Онлайн-тесты — главная" className={styles.brand} href="/">
            <span aria-hidden="true" className={styles.brandDot} />
            <span>Русский язык. Онлайн-тесты</span>
          </Link>
        </header>

        <section aria-labelledby="catalog-title" className={styles.intro}>
          <h1 className={styles.title} id="catalog-title">
            Тренировочные тесты по русскому языку
          </h1>
          <p className={styles.subtitle}>
            Оригинальные онлайн-тесты для самостоятельной подготовки к ЦЭ/ЦТ.
          </p>
        </section>

        <Suspense fallback={<CatalogLoading />}>
          <CatalogContent />
        </Suspense>
      </div>
    </main>
  );
}
