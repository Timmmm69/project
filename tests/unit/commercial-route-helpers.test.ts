import { describe, expect, it } from "vitest";
import { CommercialError } from "@/lib/commercial/commercial-service";
import { commercialErrorResponse } from "@/lib/commercial/route-helpers";

describe("commercial error projection", () => {
  it("returns only the safe public reference and action for a verified pending order", async () => {
    const response = commercialErrorResponse(new CommercialError(
      "ORDER_ALREADY_PENDING",
      "Order already pending",
      "WAIT_FOR_PAYMENT",
      "public-order-reference"
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      error: {
        code: "ORDER_ALREADY_PENDING",
        details: {
          nextAction: "WAIT_FOR_PAYMENT",
          orderReference: "public-order-reference"
        }
      }
    });
  });

  it("does not add order details to unrelated commercial errors", async () => {
    const response = commercialErrorResponse(new CommercialError("VERIFIED_EMAIL_REQUIRED"));
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "VERIFIED_EMAIL_REQUIRED" }
    });
    expect(JSON.stringify(await commercialErrorResponse(
      new CommercialError("VERIFIED_EMAIL_REQUIRED")
    ).json())).not.toContain("orderReference");
  });
});
