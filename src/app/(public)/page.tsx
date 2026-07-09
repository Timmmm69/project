import Link from "next/link";
import { serializePublicTest } from "@/lib/public-tests/serialize";
import { prisma } from "@/server/db/client";

export const dynamic = "force-dynamic";

function formatPrice(price: number, currency: string) {
  return `${(price / 100).toFixed(2)} ${currency}`;
}

export default async function PublicCatalogPage() {
  const tests = await prisma.test.findMany({
    where: {
      status: "PUBLISHED",
      deletedAt: null
    },
    orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }]
  });
  const publicTests = tests.map(serializePublicTest);
  const ceCtCount = publicTests.filter((test) => test.mode === "ce_ct").length;

  return (
    <main className="page-shell stack">
      <header className="topbar">
        <div className="brand-mark">
          <span className="brand-dot" />
          <span>Русский язык. Онлайн-тесты</span>
        </div>
        <Link className="button secondary small" href="/admin">
          Админка
        </Link>
      </header>

      <section className="hero">
        <div className="stack compact">
          <p className="eyebrow">Подготовка к ЦЭ/ЦТ</p>
          <h1 className="page-title">Тренировочные онлайн-тесты по русскому языку</h1>
          <p className="lead">
            Выберите тест, введите email для доступа и проходите задания в формате, близком к реальной проверке:
            с таймером, первичным баллом и разбором ошибок после завершения.
          </p>
        </div>

        <dl className="meta-grid">
          <div>
            <dt>Опубликовано</dt>
            <dd>{publicTests.length}</dd>
          </div>
          <div>
            <dt>ЦЭ/ЦТ</dt>
            <dd>{ceCtCount}</dd>
          </div>
          <div>
            <dt>Результат</dt>
            <dd>после теста</dd>
          </div>
        </dl>
      </section>

      <section className="stack compact">
        <div className="toolbar">
          <div>
            <p className="eyebrow">Каталог</p>
            <h2 className="section-title">Доступные тесты</h2>
          </div>
        </div>

        {publicTests.length === 0 ? (
          <section className="panel">
            <p className="muted">Пока нет опубликованных тестов.</p>
          </section>
        ) : (
          <section className="catalog-grid">
            {publicTests.map((test) => (
              <article className="test-card" key={test.id}>
                <div className="stack compact">
                  <div className="badge-row">
                    <span className="badge accent">{test.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}</span>
                    {test.maxRawScore === 80 ? <span className="badge">полный тест</span> : null}
                  </div>
                  <div>
                    <h3 className="card-title">{test.title}</h3>
                    {test.shortDescription ? <p className="muted">{test.shortDescription}</p> : null}
                  </div>
                </div>

                <dl className="meta-grid">
                  <div>
                    <dt>Вопросы</dt>
                    <dd>{test.questionsCount}</dd>
                  </div>
                  <div>
                    <dt>Время</dt>
                    <dd>{test.durationMinutes} мин</dd>
                  </div>
                  <div>
                    <dt>Цена</dt>
                    <dd>{formatPrice(test.price, test.currency)}</dd>
                  </div>
                </dl>

                <Link className="button" href={`/tests/${test.slug}`}>
                  Открыть тест
                </Link>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}
