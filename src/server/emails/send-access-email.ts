import { DisabledEmailAdapter } from "@/server/emails/email-adapter";
import { createPendingEmailLog, markEmailLogFailed, markEmailLogSent } from "@/server/emails/email-log";

type AccessEmailInput = {
  userId: string;
  email: string;
  type: "payment_success" | "manual_access";
  testTitle: string;
  testLink: string;
  attemptsTotal: number;
  expiresAt: Date;
};

const subjects = {
  payment_success: "Доступ к тесту открыт",
  manual_access: "Вам открыт доступ к тесту"
} as const;

export async function sendAccessEmail(input: AccessEmailInput) {
  const bodyText = [
    "Здравствуйте.",
    "",
    input.type === "payment_success"
      ? "Ваш доступ к тесту открыт."
      : "Преподаватель открыл вам доступ к тесту.",
    "",
    `Тест: ${input.testTitle}`,
    `Email: ${input.email}`,
    `Количество попыток: ${input.attemptsTotal}`,
    `Доступ действует до: ${input.expiresAt.toISOString()}`,
    "",
    `Перейти к тесту: ${input.testLink}`
  ].join("\n");

  const emailInput = {
    to: input.email,
    subject: subjects[input.type],
    bodyText,
    type: input.type
  };

  const log = await createPendingEmailLog(emailInput, input.userId);

  try {
    const adapter = new DisabledEmailAdapter();
    const result = await adapter.send(emailInput);
    await markEmailLogSent(log.id, result);
  } catch (error) {
    await markEmailLogFailed(log.id, error);
  }
}
