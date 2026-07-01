import Link from "next/link";
import { notFound } from "next/navigation";
import { serializePublicTest } from "@/lib/public-tests/serialize";
import { prisma } from "@/server/db/client";
import { TestAccessForm } from "./test-access-form";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

function formatPrice(price: number, currency: string) {
  return `${(price / 100).toFixed(2)} ${currency}`;
}

export default async function PublicTestPage({ params }: PageProps) {
  const { slug } = await params;
  const test = await prisma.test.findFirst({
    where: {
      slug,
      status: "PUBLISHED",
      deletedAt: null
    }
  });

  if (!test) {
    notFound();
  }

  const publicTest = serializePublicTest(test);

  return (
    <main className="page-shell stack">
      <Link className="text-link" href="/">
        Назад к каталогу
      </Link>

      <section className="panel stack">
        <div>
          <p className="eyebrow">{publicTest.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}</p>
          <h1 className="page-title">{publicTest.title}</h1>
          {publicTest.shortDescription ? <p className="muted">{publicTest.shortDescription}</p> : null}
        </div>

        <dl className="meta-grid wide">
          <div>
            <dt>Вопросы</dt>
            <dd>{publicTest.questionsCount}</dd>
          </div>
          <div>
            <dt>Макс. балл</dt>
            <dd>{publicTest.maxRawScore}</dd>
          </div>
          <div>
            <dt>Время</dt>
            <dd>{publicTest.durationMinutes} мин</dd>
          </div>
          <div>
            <dt>Попытки</dt>
            <dd>{publicTest.attemptsLimit}</dd>
          </div>
          <div>
            <dt>Доступ</dt>
            <dd>{publicTest.accessDays} дней</dd>
          </div>
          <div>
            <dt>Цена</dt>
            <dd>{formatPrice(publicTest.price, publicTest.currency)}</dd>
          </div>
        </dl>

        {publicTest.fullDescription ? <p>{publicTest.fullDescription}</p> : null}
      </section>

      <section className="panel stack">
        <div>
          <h2 className="section-title">Проверить доступ</h2>
          <p className="muted">Введите email, на который был или будет оформлен доступ.</p>
        </div>
        <TestAccessForm testId={publicTest.id} />
      </section>
    </main>
  );
}
