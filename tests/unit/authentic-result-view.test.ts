import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AuthenticResultSurface,
  ResultLoadingSurface,
  ResultNotReadySurface,
  ResultTemporaryErrorSurface
} from "../../src/app/(public)/results/[attemptId]/result-surface";
import type { AuthenticResultSummary } from "../../src/app/(public)/results/[attemptId]/result-view-model";

const completedSummary: AuthenticResultSummary = {
  status: "completed",
  completedAt: "16 июля 2026, 20:05 (Минск)",
  primaryScore: 80,
  primaryMax: 80,
  partA: { score: 36, maxScore: 36 },
  partB: { score: 44, maxScore: 44 }
};

function noop() {}

describe("authentic Result presentation", () => {
  it("renders exact aggregate-only success copy and catalog navigation", () => {
    const html = renderToStaticMarkup(createElement(AuthenticResultSurface, {
      summary: completedSummary
    }));

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Результат попытки");
    expect(html).toContain("Статус: завершено вручную");
    expect(html).toContain("Завершено: 16 июля 2026, 20:05 (Минск)");
    expect(html).toContain('aria-label="Общий первичный результат: 80 из 80"');
    expect(html).toContain('aria-hidden="true" class="');
    expect(html).toContain('data-result-value="total">80 из 80</p>');
    expect(html).toContain("Part A: 36 из 36");
    expect(html).toContain("Part B: 44 из 44");
    expect(html).toContain("Это первичный результат этой тренировочной попытки. Он не является прогнозом результата ЦЭ или ЦТ.");
    expect(html).toContain('href="/"');
    expect(html).toContain("Вернуться в каталог");

    for (const prohibited of [
      "CE/CT Russian 2026 format",
      "ЦЭ/ЦТ",
      "Первичный балл",
      "80 / 80",
      "Ошибки",
      "Разбор",
      "Детали ответов",
      "Browser Part A",
      "Browser Part B",
      "Ответ ученика",
      "Первичные баллы",
      "Результат можно открыть повторно в течение 12 месяцев.",
      "поддержк"
    ]) {
      expect(html).not.toContain(prohibited);
    }
  });

  it("renders the exact expired status", () => {
    const html = renderToStaticMarkup(createElement(AuthenticResultSurface, {
      summary: { ...completedSummary, status: "expired" }
    }));

    expect(html).toContain("Статус: время истекло");
    expect(html).not.toContain("Статус: завершено вручную");
  });

  it("renders the canonical polite loading state", () => {
    const html = renderToStaticMarkup(createElement(ResultLoadingSurface));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Загружаем результат…");
    expect(html).not.toContain("80 из 80");
  });

  it("renders a safe canonical temporary error with retry", () => {
    const html = renderToStaticMarkup(createElement(ResultTemporaryErrorSurface, {
      onRetry: noop,
      retrying: false
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("Не удалось загрузить результат. Попытка не будет завершена повторно. Повторите загрузку.");
    expect(html).toContain("Повторить загрузку");
    expect(html).not.toContain("P1001");
    expect(html).not.toContain("Prisma");
    expect(html).not.toContain("PostgreSQL");
    expect(html).not.toContain("поддержк");
  });

  it("renders canonical not-ready without partial scores", () => {
    const html = renderToStaticMarkup(createElement(ResultNotReadySurface, {
      onRetry: noop,
      retrying: false
    }));

    expect(html).toContain("Результат ещё не готов. Повторное завершение не требуется.");
    expect(html).toContain("Повторить загрузку");
    expect(html).not.toContain("Общий первичный результат");
    expect(html).not.toContain("Part A:");
    expect(html).not.toContain("Part B:");
    expect(html).not.toContain("поддержк");
  });
});
