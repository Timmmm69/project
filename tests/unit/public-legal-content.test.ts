import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LEGAL_DOCUMENT_VERSION, PUBLIC_LEGAL_LINKS, SELLER, SERVICE_TERMS } from "@/content/legal";

describe("public WEBPAY legal content", () => {
  it("publishes the approved seller and support identity", () => {
    expect(SELLER).toMatchObject({
      displayName: "Колюгова Софья Игоревна",
      status: "физическое лицо, применяющее налог на профессиональный доход",
      unp: "EE8047957",
      country: "Республика Беларусь",
      email: "kolyugova42@icloud.com"
    });
    expect(SELLER.phoneHref).toBe("tel:+375293768988");
  });

  it("keeps the commercial offer in BYN and aligned with the immutable order snapshot", () => {
    expect(SERVICE_TERMS).toMatchObject({
      price: "10,00 BYN",
      attempts: 1,
      startWindowDays: 90,
      durationMinutes: 120,
      resultRetentionMonths: 12
    });
  });

  it("exposes same-origin routes for every public legal requirement", () => {
    expect(LEGAL_DOCUMENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const route of Object.values(PUBLIC_LEGAL_LINKS)) {
      expect(route).toMatch(/^\/[a-z-]+$/);
    }
  });

  it("keeps the example checkout legal version aligned with the published documents", () => {
    const exampleEnvironment = readFileSync(".env.example", "utf8");
    expect(exampleEnvironment).toContain(`LEGAL_BUNDLE_VERSION="${LEGAL_DOCUMENT_VERSION}"`);
  });
});
