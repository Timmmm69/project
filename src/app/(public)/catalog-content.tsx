import { serializePublicTest } from "@/lib/public-tests/serialize";
import { prisma } from "@/server/db/client";
import { CatalogRetryButton } from "./catalog-retry-button";
import { CatalogView } from "./catalog-view";

export async function CatalogContent() {
  try {
    const tests = await prisma.test.findMany({
      where: {
        status: "PUBLISHED",
        deletedAt: null
      },
      orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }]
    });
    const publicTests = tests.map(serializePublicTest);

    if (publicTests.length === 0) {
      return <CatalogView state="empty" />;
    }

    return <CatalogView state="success" tests={publicTests} />;
  } catch {
    return <CatalogView retryControl={<CatalogRetryButton />} state="error" />;
  }
}
