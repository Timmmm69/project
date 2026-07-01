import { z } from "zod";
import { normalizeCorrectAnswer, parseMultipleChoiceLetters, isOptionLetter } from "@/lib/questions/normalization";

const optionSchema = z.string().trim().max(1000).nullable().optional();

const baseQuestionSchema = z.object({
  questionText: z.string().trim().min(1).max(10000),
  questionType: z.enum(["single_choice", "multiple_choice", "short_text"]),
  optionA: optionSchema,
  optionB: optionSchema,
  optionC: optionSchema,
  optionD: optionSchema,
  correctAnswer: z.string().trim().min(1).max(2000),
  topic: z.string().trim().min(1).max(200),
  subtopic: z.string().trim().max(200).nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  points: z.number().int().min(1).max(100).default(1),
  explanation: z.string().trim().max(10000).nullable().optional(),
  source: z.string().trim().max(1000).nullable().optional()
});

function filledOptions(data: {
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
}) {
  return [data.optionA, data.optionB, data.optionC, data.optionD].filter(
    (option) => option && option.trim().length > 0
  );
}

function optionExists(letter: string, data: {
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
}) {
  const options = {
    A: data.optionA,
    B: data.optionB,
    C: data.optionC,
    D: data.optionD
  } as const;
  return Boolean(options[letter as keyof typeof options]?.trim());
}

export const adminQuestionInputSchema = baseQuestionSchema
  .superRefine((data, context) => {
    if (data.questionType === "single_choice") {
      if (filledOptions(data).length < 2) {
        context.addIssue({
          code: "custom",
          path: ["optionA"],
          message: "Для single_choice нужно минимум 2 варианта ответа"
        });
      }

      const answer = normalizeCorrectAnswer(data.questionType, data.correctAnswer);
      if (!isOptionLetter(answer) || !optionExists(answer, data)) {
        context.addIssue({
          code: "custom",
          path: ["correctAnswer"],
          message: "Правильный ответ должен быть A/B/C/D и указывать на заполненный вариант"
        });
      }
    }

    if (data.questionType === "multiple_choice") {
      if (filledOptions(data).length < 2) {
        context.addIssue({
          code: "custom",
          path: ["optionA"],
          message: "Для multiple_choice нужно минимум 2 варианта ответа"
        });
      }

      const answers = parseMultipleChoiceLetters(data.correctAnswer);
      if (answers.length === 0 || answers.some((answer) => !isOptionLetter(answer) || !optionExists(answer, data))) {
        context.addIssue({
          code: "custom",
          path: ["correctAnswer"],
          message: "Правильные ответы должны быть A/B/C/D через запятую и указывать на заполненные варианты"
        });
      }
    }

    if (data.questionType === "short_text" && normalizeCorrectAnswer(data.questionType, data.correctAnswer).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["correctAnswer"],
        message: "Для short_text нужен хотя бы один допустимый ответ"
      });
    }
  })
  .transform((data) => ({
    ...data,
    correctAnswer: normalizeCorrectAnswer(data.questionType, data.correctAnswer),
    optionA: data.questionType === "short_text" ? null : data.optionA ?? null,
    optionB: data.questionType === "short_text" ? null : data.optionB ?? null,
    optionC: data.questionType === "short_text" ? null : data.optionC ?? null,
    optionD: data.questionType === "short_text" ? null : data.optionD ?? null,
    subtopic: data.subtopic || null,
    explanation: data.explanation || null,
    source: data.source || null
  }));

export const adminQuestionOrderSchema = z.object({
  direction: z.enum(["up", "down"])
});
