import { NextResponse } from "next/server";
import { processCommercialProviderNotification } from "@/lib/commercial/commercial-service";
import { isLocalFakeCommercialProviderEnabled, LocalFakeCommercialProvider } from "@/lib/commercial/providers";

export async function POST(request: Request) {
  if (!isLocalFakeCommercialProviderEnabled()) {
    return new NextResponse("Not found", { status: 404 });
  }
  const form = await request.formData();
  const merchantReference = String(form.get("merchant_reference") ?? "");
  const amountMinor = String(form.get("amount_minor") ?? "");
  const currency = String(form.get("currency") ?? "BYN");
  const returnUrl = String(form.get("return_url") ?? "");
  if (!merchantReference || !returnUrl) return new NextResponse("Invalid fake checkout", { status: 422 });

  const rawBody = JSON.stringify({
    merchant_reference: merchantReference,
    payment_id: `fake-${merchantReference}`,
    event_key: `fake-event-${merchantReference}`,
    status: "paid",
    amount_minor: amountMinor,
    currency,
    signature: "local-fake-valid"
  });
  const provider = new LocalFakeCommercialProvider();
  const notification = await provider.verifyNotification(rawBody);
  await processCommercialProviderNotification({ notification, rawBody, provider: provider.provider });
  return NextResponse.redirect(returnUrl, 303);
}
