import type { MvpQuestionType } from "@/lib/questions/enums";
import { normalizeCorrectAnswer } from "@/lib/questions/normalization";

export function normalizeAttemptAnswer(questionType: MvpQuestionType, answer: string | null) {
  if (answer === null) {
    return null;
  }
  if (questionType === "short_answer_token") {
    return answer;
  }
  return normalizeCorrectAnswer(questionType, answer);
}
