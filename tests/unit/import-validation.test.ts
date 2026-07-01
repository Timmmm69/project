import { describe, expect, it } from "vitest";
import { IMPORT_TEMPLATE_COLUMNS } from "@/lib/imports/template";
import { mapRecordToImportRow, validateImportRows } from "@/lib/imports/validation";

const header = [...IMPORT_TEMPLATE_COLUMNS];

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
});
