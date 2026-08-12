import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { serializePublicTest } from "@/lib/public-tests/serialize";
import { commercialLegalConfig, COMMERCIAL_PRODUCT_CODE, isCommercialCheckoutEnabled } from "@/lib/commercial/config";
import { CommercialCheckoutForm } from "./commercial-checkout-form";
import { prisma } from "@/server/db/client";
import { TestAccessForm } from "./test-access-form";
import { parseVerifiedCommercialSessionMode } from "@/server/auth/verified-student-session/config";
import {
  resolveVerifiedStudentEntryDestination,
  type VerifiedStudentEntryResolution
} from "@/server/auth/verified-student-session/destination-guard";
import { isAuthenticRikzRussianExamMode } from "@/server/auth/verified-student-session/exam-mode";
import { resolveRecoveryUiAvailability } from "@/server/recovery/ui-availability";
import { PrestartAccessExpired, PrestartConfirmation } from "./prestart-confirmation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams?: Promise<{
    view?: string | string[];
  }>;
};

function formatPrice(price: number, currency: string) {
  return `${(price / 100).toFixed(2)} ${currency}`;
}

export default async function PublicTestPage({ params, searchParams }: PageProps) {
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
  const legal = commercialLegalConfig();
  const authenticCommercialTest = isAuthenticRikzRussianExamMode(
    test.examMode,
    "CURRENT_TEST"
  );
  let isFullCeCt = publicTest.mode === "ce_ct" && publicTest.maxRawScore === 80;
  const commercialProduct = isCommercialCheckoutEnabled()
    ? await prisma.commercialProduct.findFirst({
      where: { code: "russian-training-variant-01", testId: test.id, isActive: true },
      select: {
        code: true,
        priceMinor: true,
        currency: true,
        attemptLimit: true,
        startWindowDays: true
      }
    })
    : null;
  const showCommercialCheckout = Boolean(commercialProduct);
  const recoveryAvailability = resolveRecoveryUiAvailability();
  const recovery = authenticCommercialTest && commercialProduct && recoveryAvailability.available &&
    recoveryAvailability.productCode === commercialProduct.code
    ? {
        productCode: recoveryAvailability.productCode,
        supportEmail: legal.supportEmail
      }
    : null;
  isFullCeCt &&= !showCommercialCheckout;
  let hideLegacyPrivateControls = false;
  let entryResolution: VerifiedStudentEntryResolution | null = null;
  try {
    entryResolution = await resolveVerifiedStudentEntryDestination({ testSlug: slug });
  } catch {
    const authenticTest = isAuthenticRikzRussianExamMode(test.examMode, "CURRENT_TEST");
    try {
      hideLegacyPrivateControls = authenticTest &&
        parseVerifiedCommercialSessionMode(process.env.VERIFIED_COMMERCIAL_SESSION_MODE) === "enforce";
    } catch {
      hideLegacyPrivateControls = authenticTest;
    }
  }
  if (entryResolution?.status === "AUTHORIZED") {
    if (entryResolution.nextAction === "OPEN_ATTEMPT" || entryResolution.nextAction === "OPEN_RESULT") {
      redirect(entryResolution.nextUrl);
    }
  }
  if (entryResolution) {
    hideLegacyPrivateControls = entryResolution.mode === "enforce" &&
      entryResolution.classification === "AUTHENTIC";
  }
  const view = searchParams ? (await searchParams).view : undefined;
  const verifiedOpenPre = entryResolution?.status === "AUTHORIZED" &&
    entryResolution.nextAction === "OPEN_PRE";
  const verifiedProductView = verifiedOpenPre && view === "product";
  const verifiedAccessExpired = entryResolution?.status === "BLOCKED" &&
    entryResolution.mode === "enforce" &&
    entryResolution.classification === "AUTHENTIC" &&
    entryResolution.reason === "ACCESS_EXPIRED";

  if (verifiedAccessExpired) {
    return (
      <main className="page-shell prestart-page stack">
        <header className="topbar">
          <Link className="text-link" href="/">
            Назад к каталогу
          </Link>
          <span className="badge accent">{publicTest.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}</span>
        </header>
        <PrestartAccessExpired />
      </main>
    );
  }

  if (verifiedOpenPre && !verifiedProductView) {
    return (
      <main className="page-shell prestart-page stack">
        <header className="topbar">
          <Link className="text-link" href="/">
            Назад к каталогу
          </Link>
          <span className="badge accent">{publicTest.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}</span>
        </header>
        <PrestartConfirmation testId={publicTest.id} cancelHref={`/tests/${slug}?view=product`} />
      </main>
    );
  }

  return (
    <main className="page-shell stack">
      <header className="topbar">
        <Link className="text-link" href="/">
          Назад к каталогу
        </Link>
        <span className="badge accent">{publicTest.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировка"}</span>
      </header>

      <section className="split-layout">
        <div className="stack">
          <section className="hero compact">
            <div className="stack compact">
              <div className="badge-row">
                <span className="badge accent">{publicTest.mode === "ce_ct" ? "ЦЭ/ЦТ" : "Тренировочный тест"}</span>
                {isFullCeCt ? <span className="badge">шкала РИКЗ 0-100</span> : null}
              </div>
              <h1 className="page-title">{publicTest.title}</h1>
              {publicTest.shortDescription ? <p className="lead">{publicTest.shortDescription}</p> : null}
              {publicTest.fullDescription ? <p className="muted">{publicTest.fullDescription}</p> : null}
            </div>
          </section>

          <section className="panel stack">
            <h2 className="section-title">Что входит</h2>
            <dl className="meta-grid wide">
              <div>
                <dt>Вопросы</dt>
                <dd>{publicTest.questionsCount}</dd>
              </div>
              <div>
                <dt>Макс. первичный</dt>
                <dd>{publicTest.maxRawScore}</dd>
              </div>
              <div>
                <dt>Время</dt>
                <dd>{publicTest.durationMinutes} мин</dd>
              </div>
              <div>
                <dt>Попытки</dt>
                <dd>{showCommercialCheckout ? commercialProduct?.attemptLimit : publicTest.attemptsLimit}</dd>
              </div>
              <div>
                <dt>Доступ</dt>
                <dd>{showCommercialCheckout ? "90 дней до старта" : `${publicTest.accessDays} дней`}</dd>
              </div>
              <div>
                <dt>Цена</dt>
                <dd>{showCommercialCheckout && commercialProduct ? formatPrice(commercialProduct.priceMinor, commercialProduct.currency) : formatPrice(publicTest.price, publicTest.currency)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel stack compact">
            <h2 className="section-title">Как проходит тест</h2>
            <div className="meta-grid">
              <div>
                <dt>1. Доступ</dt>
                <dd>Email, оплата, код или ручная выдача</dd>
              </div>
              <div>
                <dt>2. Попытка</dt>
                <dd>Таймер и автосохранение ответов</dd>
              </div>
              <div>
                <dt>3. Результат</dt>
                <dd>{showCommercialCheckout ? "Первичный результат" : "Первичный балл и разбор ошибок"}</dd>
              </div>
            </div>
          </section>
        </div>

        <aside className="panel stack">
          {verifiedProductView ? (
            <div className="stack compact">
              <p className="eyebrow">Доступ к тесту</p>
              <h2 className="section-title">Доступ готов. Попытка ещё не начата.</h2>
              <Link className="button" href={`/tests/${slug}`}>Перейти к началу</Link>
            </div>
          ) : (
            <>
              <div>
                <p className="eyebrow">Доступ к тесту</p>
                <h2 className="section-title">{showCommercialCheckout && commercialProduct ? formatPrice(commercialProduct.priceMinor, commercialProduct.currency) : formatPrice(publicTest.price, publicTest.currency)}</h2>
                <p className="muted">Введите email. Если доступ уже открыт, можно сразу начать или продолжить попытку.</p>
              </div>
              {showCommercialCheckout && commercialProduct ? (
                <CommercialCheckoutForm
                  legal={legal}
                  testId={publicTest.id}
                  productCode={COMMERCIAL_PRODUCT_CODE}
                  priceMinor={commercialProduct.priceMinor}
                  currency={commercialProduct.currency}
                  recovery={recovery}
                />
              ) : null}
              {!hideLegacyPrivateControls ? <TestAccessForm testId={publicTest.id} hidePayment={showCommercialCheckout} /> : null}
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
