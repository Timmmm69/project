import { describe, expect, it } from "vitest";
import { normalizeEmail } from "@/lib/validation/email";
import { questionTypeSchema, studentIdentifySchema, testModeSchema } from "@/lib/validation/schemas";

describe("validation foundation", () => {
  it("normalizes email with trim and lowercase", () => {
    expect(normalizeEmail("  Student@Example.COM  ")).toBe("student@example.com");
  });

  it("normalizes student identify email through schema", () => {
    const parsed = studentIdentifySchema.parse({
      email: "  USER@Example.com ",
      name: "Иван"
    });

    expect(parsed.email).toBe("user@example.com");
    expect(parsed.name).toBe("Иван");
  });

  it("allows only MVP question types", () => {
    expect(questionTypeSchema.safeParse("single_choice").success).toBe(true);
    expect(questionTypeSchema.safeParse("multiple_choice").success).toBe(true);
    expect(questionTypeSchema.safeParse("short_text").success).toBe(true);
    expect(questionTypeSchema.safeParse("essay").success).toBe(false);
  });

  it("allows only MVP test modes", () => {
    expect(testModeSchema.safeParse("training").success).toBe(true);
    expect(testModeSchema.safeParse("ce_ct").success).toBe(true);
    expect(testModeSchema.safeParse("official_exam").success).toBe(false);
  });
});
