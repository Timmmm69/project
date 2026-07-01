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

  return (
    <main className="page-shell stack">
      <section className="toolbar">
        <div>
          <p className="eyebrow">ЦЭ/ЦТ</p>
          <h1 className="page-title">Каталог тестов</h1>
          <p className="muted">Онлайн-тесты по русскому языку для подготовки.</p>
        </div>
      </section>

      {publicTests.length === 0 ? (
        <section className="panel">
          <p className="muted">Пока нет опубликованных тестов.</p>
        </section>
      ) : (
        <section className="catalog-grid">
          {publicTests.map((test) => (
            <article className="test-card" key={test.id}>
              <div className="stack compact">
                <div>
                  <p className="eyebrow">{test.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}</p>
                  <h2 className="card-title">{test.title}</h2>
                  {test.shortDescription ? <p className="muted">{test.shortDescription}</p> : null}
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
              </div>
              <Link className="button" href={`/tests/${test.slug}`}>
                Открыть тест
              </Link>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
