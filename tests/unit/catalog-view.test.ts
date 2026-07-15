import { createElement } from "react";
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
  showScaledScore: false,
  isAuthentic: true
};

const adversarialGenericTest: CatalogTest = {
  id: "generic-test",
  title: "Generic-тест с характеристиками ЦЭ/ЦТ",
  slug: "generic-test",
  mode: "ce_ct",
  shortDescription: "Обычный опубликованный тест.",
  price: 750,
  currency: "BYN",
  durationMinutes: 120,
  attemptsLimit: 1,
  questionsCount: 40,
  maxRawScore: 80,
  showScaledScore: false,
  isAuthentic: false
};

describe("CatalogView", () => {
  it("renders a semantic loading state without invented product facts", () => {
    const html = renderToStaticMarkup(createElement(CatalogLoading));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Загружается каталог тестов"');
    expect(html).toContain("Загружаем тесты…");
    expect(html).not.toContain("BYN");
    expect(html).not.toContain("Доступен для покупки");
  });

  it("renders authentic-only content when the server marks the product authentic", () => {
    const html = renderToStaticMarkup(createElement(CatalogView, {
      state: "success",
      tests: [authenticTest]
    }));

    expect(html).toContain("Тренировочный тест по русскому языку");
    expect(html).toContain("Оригинальный тренировочный вариант");
    expect(html).toContain("10 BYN");
    expect(html).toContain("Одна покупка — одна попытка");
    expect(html).toContain("Только первичный результат");
    expect(html).toContain("Подробнее о тесте");
    expect(html).toContain("Уже есть доступ?");
    expect(html).toContain("Не является официальным материалом ЦЭ/ЦТ.");
    expect(html).not.toContain("Админка");
    expect(html).not.toContain("разбор ошибок");
  });

  it("does not infer authenticity from mode or matching numeric characteristics", () => {
    const html = renderToStaticMarkup(createElement(CatalogView, {
      state: "success",
      tests: [adversarialGenericTest]
    }));

    expect(html).toContain("Generic-тест с характеристиками ЦЭ/ЦТ");
    expect(html).toContain("40 заданий");
    expect(html).toContain("120 минут");
    expect(html).toContain("1 попытка");
    expect(html).toContain("7,50 BYN");
    expect(html).toContain('href="/tests/generic-test"');
    expect(html).not.toContain("Оригинальный тренировочный вариант");
    expect(html).not.toContain("Одна покупка — одна попытка");
    expect(html).not.toContain("Только первичный результат");
    expect(html).not.toContain("Не является официальным материалом ЦЭ/ЦТ.");
  });

  it("renders the empty state without product or inactive support actions", () => {
    const html = renderToStaticMarkup(createElement(CatalogView, { state: "empty" }));

    expect(html).toContain("Сейчас нет доступных тестов");
    expect(html).not.toContain("Подробнее о тесте");
    expect(html).not.toContain("Обратиться в поддержку");
  });

  it("renders a safe error state with retry and without provider or database details", () => {
    const retryControl = createElement("button", { type: "button" }, "Повторить");
    const html = renderToStaticMarkup(createElement(CatalogView, {
      retryControl,
      state: "error"
    }));

    expect(html).toContain("Не удалось загрузить каталог");
    expect(html).toContain("Данные о тестах не изменены. Повторите загрузку.");
    expect(html).toContain("Повторить");
    expect(html).not.toContain("P1001");
    expect(html).not.toContain("Can&#x27;t reach database server");
    expect(html).not.toContain("PrismaClient");
    expect(html).not.toContain("PostgreSQL");
  });
});
