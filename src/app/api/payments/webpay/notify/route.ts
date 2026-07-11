import { apiSuccess } from "@/lib/api-response";
import { processCommercialProviderNotification } from "@/lib/commercial/commercial-service";
import { WebPaySandboxProvider } from "@/lib/commercial/providers";
import { logEvent } from "@/server/events/log-event";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const provider = new WebPaySandboxProvider();
  const callback = await provider.verifyNotification(rawBody);

  if (!callback.merchantReference || callback.redactedPayload.checkout_fields_valid !== "true") {
    await logEvent({
      eventType: "payment_event_rejected",
      entityType: "commercial_payment_attempt",
      payload: { provider: "webpay_sandbox", reason: "INVALID_CALLBACK_SIGNAL" }
    });
    return apiSuccess({ received: true, duplicate: false, verified: false });
  }

  try {
    const notification = await provider.fetchPaymentStatus({
      merchantReference: callback.merchantReference,
      providerPaymentId: null
    });
    if (notification.merchantReference !== callback.merchantReference) {
      await logEvent({
        eventType: "payment_event_rejected",
        entityType: "commercial_payment_attempt",
        payload: { provider: "webpay_sandbox", reason: "MERCHANT_REFERENCE_MISMATCH" }
      });
      return apiSuccess({ received: true, duplicate: false, verified: false });
    }

    const authoritativeBody = JSON.stringify(notification.redactedPayload);
    const result = await processCommercialProviderNotification({
      notification,
      rawBody: authoritativeBody,
      provider: provider.provider
    });
    await logEvent({
      eventType: result.rejected ? "payment_event_rejected" : "payment_notification_received",
      entityType: "commercial_payment_attempt",
      payload: { provider: "webpay_sandbox", duplicate: result.duplicate, rejected: result.rejected }
    });
    return apiSuccess({ received: true, duplicate: result.duplicate, verified: !result.rejected });
  } catch {
    await logEvent({
      eventType: "payment_event_rejected",
      entityType: "commercial_payment_attempt",
      payload: { provider: "webpay_sandbox", reason: "STATUS_VERIFICATION_UNAVAILABLE" }
    });
    return apiSuccess({ received: true, duplicate: false, verified: false });
  }
}
