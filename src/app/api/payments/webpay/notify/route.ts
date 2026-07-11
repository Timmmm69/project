import { apiSuccess } from "@/lib/api-response";
import { processCommercialProviderNotification } from "@/lib/commercial/commercial-service";
import { WebPaySandboxProvider } from "@/lib/commercial/providers";
import { logEvent } from "@/server/events/log-event";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const provider = new WebPaySandboxProvider();
  const notification = await provider.verifyNotification(rawBody);
  const result = await processCommercialProviderNotification({ notification, rawBody, provider: provider.provider });
  await logEvent({
    eventType: notification.signatureValid ? "payment_notification_received" : "payment_event_rejected",
    entityType: "commercial_payment_attempt",
    payload: { provider: "webpay_sandbox", duplicate: result.duplicate, rejected: result.rejected }
  });
  return apiSuccess({ received: true, duplicate: result.duplicate });
}
