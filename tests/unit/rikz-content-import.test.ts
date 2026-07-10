import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { parseCsvImport } from "@/lib/imports/parse";
import { validateImportRows } from "@/lib/imports/validation";

type SourceQuestion = {
  id: string;
  part: "A" | "B";
  official_number: number;
  prompt: string;
  primary_points: number;
  accepted_answers?: string[];
};

type ContentManifest = {
  question_count: number;
  part_counts: { A: number; B: number };
  max_raw_score: number;
  qa: { requires_human_decision: boolean };
};

const contentRoot = resolve(process.cwd(), "content/rikz_russian_2026/variant-01");
const sourceRoot = resolve(contentRoot, "source");

function readUtf8(path: string) {
  return readFileSync(path, "utf8");
}

describe("RIKZ Russian 2026 content package", () => {
  it("keeps the final source package structurally reconciled", () => {
    const questions = JSON.parse(readUtf8(resolve(sourceRoot, "questions.final.json"))) as SourceQuestion[];
    const manifest = JSON.parse(readUtf8(resolve(sourceRoot, "test_manifest.final.json"))) as ContentManifest;
    const csvRows = parseCsv(readUtf8(resolve(sourceRoot, "questions.final.csv")), {
      columns: true,
      skip_empty_lines: true
    }) as Array<{ id: string; accepted_answers: string }>;

    expect(questions).toHaveLength(40);
    expect(csvRows).toHaveLength(40);
    expect(new Set(questions.map((question) => question.id))).toEqual(new Set(csvRows.map((question) => question.id)));
    expect(questions.filter((question) => question.part === "A")).toHaveLength(18);
    expect(questions.filter((question) => question.part === "B")).toHaveLength(22);
    expect(questions.reduce((sum, question) => sum + question.primary_points, 0)).toBe(80);
    expect(manifest).toMatchObject({
      question_count: 40,
      part_counts: { A: 18, B: 22 },
      max_raw_score: 80,
      qa: { requires_human_decision: false }
    });

    for (const question of questions.filter((item) => item.part === "B")) {
      const csvQuestion = csvRows.find((item) => item.id === question.id);
      expect(JSON.parse(csvQuestion?.accepted_answers ?? "[]")).toEqual(question.accepted_answers);
    }
  });

  it("maps the final content into a valid authentic importer file without changing keys", () => {
    const sourceQuestions = JSON.parse(readUtf8(resolve(sourceRoot, "questions.final.json"))) as SourceQuestion[];
    const imported = parseCsvImport(Buffer.from(readUtf8(resolve(contentRoot, "questions.import.csv")), "utf8"));
    const validation = validateImportRows({
      header: imported.header,
      rows: imported.rows,
      parseErrors: imported.errors,
      examMode: "rikz_russian_2026"
    });

    expect(validation.errors).toEqual([]);
    expect(validation.preview).toHaveLength(40);
    expect(validation.preview.filter((question) => question.officialPart === "A")).toHaveLength(18);
    expect(validation.preview.filter((question) => question.officialPart === "B")).toHaveLength(22);
    expect(validation.preview.reduce((sum, question) => sum + question.points, 0)).toBe(80);

    const partA1 = validation.preview.find((question) => question.officialPart === "A" && question.officialNumber === 1);
    const partB14 = validation.preview.find((question) => question.officialPart === "B" && question.officialNumber === 14);
    expect(partA1?.optionE).toBe("пл..вец");
    expect(partB14).toMatchObject({
      acceptedAnswers: ["лексикология"],
      responseSubtype: "word"
    });

    const sharedIds = ["A17", "A18", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9"];
    for (const id of sharedIds) {
      const source = sourceQuestions.find((question) => question.id === id)!;
      const preview = validation.preview.find(
        (question) => `${question.officialPart}${question.officialNumber}` === id
      );
      expect(preview?.questionText).toContain("Текст к заданиям A17–A18 и B1–B9");
      expect(preview?.questionText.endsWith(source.prompt)).toBe(true);
    }
  });
});
