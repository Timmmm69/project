import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { CatalogContent } from "./catalog-content";
import { CatalogLoading } from "./catalog-view";
import styles from "./catalog.module.css";

export const dynamic = "force-dynamic";

export default function PublicCatalogPage() {
  return (
    <main className={`${styles.page} public-catalog`}>
      <div className={styles.container}>
        <header className={styles.header}>
          <Link aria-label="Русский язык. Онлайн-тесты — главная" className={styles.brand} href="/">
            <span aria-hidden="true" className="brand-symbol">РЯ</span>
            <span>Практика русского</span>
          </Link>
        </header>

        <section aria-labelledby="catalog-title" className="hero catalog-hero">
          <div className="hero-copy stack compact">
            <p className="eyebrow">Подготовка к ЦЭ/ЦТ</p>
            <h1 className="page-title" id="catalog-title">Практика русского для ЦЭ и ЦТ</h1>
            <p className="lead">
              Тренируйтесь в формате экзамена: с таймером, автосохранением и понятным результатом после завершения.
            </p>
            <a className="button hero-action" href="#tests">Выбрать тест</a>
          </div>

          <figure className="hero-media">
            <Image
              alt="Рабочее место с тетрадью и материалами для подготовки"
              fill
              preload
              sizes="(max-width: 920px) 100vw, 48vw"
              src="/images/exam-prep-study.png"
            />
          </figure>
        </section>

        <section className="catalog-section stack compact" id="tests">
          <div>
            <h2 className="section-title">Выберите тренировку</h2>
            <p className="muted">Каждый тест открывается отдельно. Условия доступа указаны на странице варианта.</p>
          </div>
          <Suspense fallback={<CatalogLoading />}>
            <CatalogContent />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
