import { prisma } from "@/server/db/client";
import type { SendEmailInput, SendEmailResult } from "@/server/emails/email-adapter";

export async function createPendingEmailLog(input: SendEmailInput, userId?: string) {
  return prisma.emailLog.create({
    data: {
      userId,
      email: input.to,
      type: input.type,
      subject: input.subject,
      body: input.bodyText ?? input.bodyHtml
    }
  });
}

export async function markEmailLogSent(id: string, result: SendEmailResult) {
  return prisma.emailLog.update({
    where: { id },
    data: {
      status: "SENT",
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      sentAt: new Date()
    }
  });
}

export async function markEmailLogFailed(id: string, error: unknown) {
  return prisma.emailLog.update({
    where: { id },
    data: {
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : String(error)
    }
  });
}
