import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const product = {
  code: "russian-training-variant-01",
  testSlug: process.env.COMMERCIAL_PRODUCT_TEST_SLUG?.trim() || "russian_training_variant_01_corrected",
  name: "Тренировочный вариант по русскому языку № 1",
  priceMinor: 1000,
  currency: "BYN",
  attemptLimit: 1,
  startWindowDays: 90,
  resultRetentionDays: 365
};

async function main() {
  const test = await prisma.test.findUnique({
    where: { slug: product.testSlug },
    select: { id: true, examMode: true, deletedAt: true }
  });
  if (!test || test.deletedAt || test.examMode !== "RIKZ_RUSSIAN_2026") {
    throw new Error(`Commercial product seed requires imported authentic test "${product.testSlug}".`);
  }

  const result = await prisma.commercialProduct.upsert({
    where: { code: product.code },
    create: {
      code: product.code,
      testId: test.id,
      name: product.name,
      priceMinor: product.priceMinor,
      currency: product.currency,
      attemptLimit: product.attemptLimit,
      startWindowDays: product.startWindowDays,
      resultRetentionDays: product.resultRetentionDays,
      isActive: true
    },
    update: {
      testId: test.id,
      name: product.name,
      priceMinor: product.priceMinor,
      currency: product.currency,
      attemptLimit: product.attemptLimit,
      startWindowDays: product.startWindowDays,
      resultRetentionDays: product.resultRetentionDays,
      isActive: true
    }
  });
  console.log(`Seeded commercial product ${result.code} for test ${test.id}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
