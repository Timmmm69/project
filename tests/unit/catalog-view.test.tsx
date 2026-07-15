import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatalogLoading, CatalogView, type CatalogTest } from "../../src/app/(public)/catalog-view";

const authenticTest: CatalogTest = {
  id: "authentic-test",
  title: "Тренировочный тест по русскому языку",
  slug: "authentic-test",
  mode: "ce_ct",
  shortDescription: "Краткое описание",
  price: 1000,
  currency: "BYN",
  durationMinutes: 120,
  attemptsLimit: 1,
  questionsCount: 40,
  maxRawScore: 80,
  showScaledScore: false
};

const genericTest: CatalogTest = {
  id: "generic-test",
  title: "Тест по лексике",
  slug: "generic-test",
  mode: "training",
  shortDescription: "Короткая тематическая тренировка.",
  price: 750,
  currency: "BYN",
  durationMinutes: 30,
  attemptsLimit: 2,
  questionsCount: 12,
  maxRawScore: 12,
  showScaledScore: true
};

describe("CatalogView", () => {
  it("renders a semantic loading state without invented product facts", () => {
    const html = renderToStaticMarkup(<CatalogLoading />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Загружается каталог тестов"');
    expect(html).toContain("Загружаем тесты…");
    expect(html).not.toContain("BYN");
    expect(html).not.toContain("Доступен для покупки");
  });

  it("renders the approved authentic product content without prohibited public claims", () => {
    const html = renderToStaticMarkup(<CatalogView state="success" tests={[authenticTest]} />);

    expect(html).toContain("Тренировочный тест по русскому языку");
    expect(html).toContain("Оригинальный тренировочный вариант");
    expect(html).toContain("10 BYN");
    expect(html).toContain("Только первичный результат");
    expect(html).toContain("Подробнее о тесте");
    expect(html).toContain("Уже есть доступ?");
    expect(html).toContain("Не является официальным материалом ЦЭ/ЦТ.");
    expect(html).not.toContain("Админка");
    expect(html).not.toContain("разбор ошибок");
  });

  it("keeps a generic product available without authentic-only claims", () => {
    const html = renderToStaticMarkup(<CatalogView state="success" tests={[genericTest]} />);

    expect(html).toContain("Тест по лексике");
    expect(html).toContain("12 заданий");
    expect(html).toContain("30 минут");
    expect(html).toContain("7,50 BYN");
    expect(html).toContain('href="/tests/generic-test"');
    expect(html).not.toContain("Оригинальный тренировочный вариант");
    expect(html).not.toContain("Одна покупка — одна попытка");
    expect(html).not.toContain("Только первичный результат");
  });

  it("renders the empty state without product or inactive support actions", () => {
    const html = renderToStaticMarkup(<CatalogView state="empty" />);

    expect(html).toContain("Сейчас нет доступных тестов");
    expect(html).not.toContain("Подробнее о тесте");
    expect(html).not.toContain("Обратиться в поддержку");
  });

  it("renders a safe error state with retry and without a raw server error", () => {
    const html = renderToStaticMarkup(
      <CatalogView retryControl={<button type="button">Повторить</button>} state="error" />
    );

    expect(html).toContain("Не удалось загрузить каталог");
    expect(html).toContain("Повторить");
    expect(html).not.toContain("P1001");
    expect(html).not.toContain("Can&#x27;t reach database server");
  });
});
