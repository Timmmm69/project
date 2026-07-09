import { describe, expect, it } from "vitest";
import { AUTHENTIC_IMPORT_TEMPLATE_COLUMNS, IMPORT_TEMPLATE_COLUMNS } from "@/lib/imports/template";
import { mapRecordToImportRow, validateImportRows } from "@/lib/imports/validation";

const header = [...IMPORT_TEMPLATE_COLUMNS];
const authenticHeader = [...AUTHENTIC_IMPORT_TEMPLATE_COLUMNS];

function authenticRecord(input: {
  part: "A" | "B";
  number: number;
  questionType?: string;
  correctAnswer?: string;
  acceptedAnswers?: string;
}) {
  if (input.part === "A") {
    return [
      "rikz_russian_2026",
      "A",
      String(input.number),
      `Placeholder Part A ${input.number}`,
      input.questionType ?? "multi_select_five",
      "Option A",
      "Option B",
      "Option C",
      "Option D",
      "Option E",
      input.correctAnswer ?? "A,C",
      "",
      "",
      "Topic",
      "",
      "medium",
      "2",
      "Original placeholder content",
      "Placeholder explanation"
    ];
  }

  return [
    "rikz_russian_2026",
    "B",
    String(input.number),
    `Placeholder Part B ${input.number}`,
    input.questionType ?? "short_answer_token",
    "",
    "",
    "",
    "",
    "",
    "",
    input.acceptedAnswers ?? "[\"placeholder\"]",
    "word",
    "Topic",
    "",
    "medium",
    "2",
    "Original placeholder content",
    "Placeholder explanation"
  ];
}

function authenticRows(overrides: Array<{ index: number; record: string[] }> = []) {
  const rows = [
    ...Array.from({ length: 18 }, (_, index) => authenticRecord({ part: "A", number: index + 1 })),
    ...Array.from({ length: 22 }, (_, index) => authenticRecord({ part: "B", number: index + 1 }))
  ];

  for (const override of overrides) {
    rows[override.index] = override.record;
  }

  return rows.map((record, index) => mapRecordToImportRow(index + 2, record, AUTHENTIC_IMPORT_TEMPLATE_COLUMNS));
}

describe("import validation", () => {
  it("accepts valid single, multiple and short text rows", () => {
    const result = validateImportRows({
      header,
      rows: [
        mapRecordToImportRow(2, [
          "Choose one",
          "single_choice",
          "A text",
          "B text",
          "",
          "",
          " a ",
          "Topic",
          "",
          "easy",
          "1",
          "",
          "Explanation"
        ]),
        mapRecordToImportRow(3, [
          "Choose many",
          "multiple_choice",
          "A text",
          "B text",
          "C text",
          "",
          " c, A, c ",
          "Topic",
          "Subtopic",
          "medium",
          "2",
          "Source",
          ""
        ]),
        mapRecordToImportRow(4, [
          "Type word",
          "short_text",
          "",
          "",
          "",
          "",
          " Answer ;  answer  ",
          "Topic",
          "",
          "",
          "1",
          "",
          ""
        ])
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.preview).toHaveLength(3);
    expect(result.preview[0]?.correctAnswer).toBe("A");
    expect(result.preview[1]?.correctAnswer).toBe("A,C");
    expect(result.preview[2]?.correctAnswer).toBe("answer");
    expect(result.preview[2]?.difficulty).toBe("medium");
  });

  it("blocks missing required fields and invalid choice answers", () => {
    const result = validateImportRows({
      header,
      rows: [
        mapRecordToImportRow(2, [
          "",
          "single_choice",
          "A text",
          "B text",
          "",
          "",
          "D",
          "",
          "",
          "medium",
          "1",
          "",
          ""
        ])
      ]
    });

    expect(result.preview).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("REQUIRED");
    expect(result.errors.map((error) => error.code)).toContain("INVALID_SINGLE_CHOICE_ANSWER");
    expect(result.errorRows).toBe(1);
  });

  it("blocks invalid headers", () => {
    const result = validateImportRows({
      header: ["bad_header"],
      rows: []
    });

    expect(result.errors.some((error) => error.code === "INVALID_HEADER")).toBe(true);
  });

  it("warns and ignores options for short_text rows", () => {
    const result = validateImportRows({
      header,
      rows: [
        mapRecordToImportRow(2, [
          "Type word",
          "short_text",
          "Ignored",
          "",
          "",
          "",
          "ok",
          "Topic",
          "",
          "hard",
          "1",
          "",
          ""
        ])
      ]
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toContain("SHORT_TEXT_OPTIONS_IGNORED");
    expect(result.preview[0]?.optionA).toBeNull();
  });

  it("blocks multiple choice rows without the MVP two-point rule", () => {
    const result = validateImportRows({
      header,
      rows: [
        mapRecordToImportRow(2, [
          "Choose many",
          "multiple_choice",
          "A text",
          "B text",
          "C text",
          "",
          "A,C",
          "Topic",
          "",
          "medium",
          "1",
          "",
          ""
        ])
      ]
    });

    expect(result.preview).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("MULTIPLE_CHOICE_POINTS_UNSUPPORTED");
  });

  it("accepts a valid rikz_russian_2026 import", () => {
    const result = validateImportRows({
      header: authenticHeader,
      rows: authenticRows(),
      examMode: "rikz_russian_2026"
    });

    expect(result.errors).toEqual([]);
    expect(result.preview).toHaveLength(40);
    expect(result.preview.filter((question) => question.officialPart === "A")).toHaveLength(18);
    expect(result.preview.filter((question) => question.officialPart === "B")).toHaveLength(22);
    expect(result.preview[0]).toMatchObject({
      examMode: "rikz_russian_2026",
      questionType: "multi_select_five",
      optionE: "Option E",
      correctAnswer: "A,C"
    });
    expect(result.preview[18]).toMatchObject({
      questionType: "short_answer_token",
      acceptedAnswers: ["placeholder"],
      responseSubtype: "word",
      correctAnswer: "placeholder"
    });
  });

  it("blocks generic question types in rikz_russian_2026 import", () => {
    const result = validateImportRows({
      header: authenticHeader,
      rows: authenticRows([
        { index: 0, record: authenticRecord({ part: "A", number: 1, questionType: "single_choice" }) }
      ]),
      examMode: "rikz_russian_2026"
    });

    expect(result.errors.map((error) => error.code)).toContain("INVALID_QUESTION_TYPE");
  });

  it("blocks wrong Part A and Part B counts in rikz_russian_2026 import", () => {
    const result = validateImportRows({
      header: authenticHeader,
      rows: authenticRows().slice(0, 39),
      examMode: "rikz_russian_2026"
    });

    expect(result.errors.map((error) => error.code)).toContain("AUTHENTIC_QUESTION_COUNT");
    expect(result.errors.map((error) => error.code)).toContain("AUTHENTIC_PART_B_COUNT");
  });

  it("blocks Part A answers outside A-E", () => {
    const result = validateImportRows({
      header: authenticHeader,
      rows: authenticRows([
        { index: 0, record: authenticRecord({ part: "A", number: 1, correctAnswer: "A,F" }) }
      ]),
      examMode: "rikz_russian_2026"
    });

    expect(result.errors.map((error) => error.code)).toContain("AUTHENTIC_PART_A_ANSWER");
  });

  it("blocks invalid JSON for Part B accepted answers", () => {
    const result = validateImportRows({
      header: authenticHeader,
      rows: authenticRows([
        { index: 18, record: authenticRecord({ part: "B", number: 1, acceptedAnswers: "not-json" }) }
      ]),
      examMode: "rikz_russian_2026"
    });

    expect(result.errors.map((error) => error.code)).toContain("INVALID_ACCEPTED_ANSWERS_JSON");
  });
});
