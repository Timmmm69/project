import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as validateUpload } from "@/app/api/admin/tests/[testId]/import/validate/route";
import { POST as commitUpload } from "@/app/api/admin/import/[importJobId]/commit/route";
import { completeAttempt, getAttemptForStudent, saveAttemptAnswer, startOrRestoreAttempt } from "@/lib/attempts/attempt-service";
import { parseTestSnapshot, serializeQuestionForStudent, type SnapshotQuestion } from "@/lib/attempts/snapshot";
import { serializeResult } from "@/lib/scoring/result-serialize";
import { runPublishCheck } from "@/lib/tests/publish-check";
import { createAdminSessionToken } from "@/server/auth/session";
import { prisma } from "@/server/db/client";

const cookieState = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => {
    const value = cookieState.values.get(name);
    return value === undefined ? undefined : { value };
  } })
}));

const shouldRun = process.env.RUN_SCORING_V2_INTEGRATION === "true";
const withDatabase = shouldRun ? describe.sequential : describe.skip;
const contentFile = resolve(process.cwd(), "content/rikz_russian_2026/variant-01/questions.import.csv");
const ownedTestIds: string[] = [];
const ownedUserIds: string[] = [];
let previousSessionSecret: string | undefined;

function requireDedicatedSchema() {
  const url = process.env.DATABASE_URL;
  if (!url || new URL(url).searchParams.get("schema") !== "scoring_v2_ci") {
    throw new Error("SCORING_V2_INTEGRATION_REQUIRES_DEDICATED_SCHEMA_scoring_v2_ci");
  }
}

async function createFixture(authentic = true) {
  const admin = await prisma.user.create({ data: { email: `scoring-admin-${randomUUID()}@example.test`, role: "ADMIN" } });
  const user = await prisma.user.create({ data: { email: `scoring-student-${randomUUID()}@example.test`, role: "STUDENT" } });
  ownedUserIds.push(admin.id, user.id);
  const scheme = await prisma.scoringScheme.findFirstOrThrow({
    where: { subject: "RUSSIAN", examType: "ce_ct", year: 2026, maxRawScore: 80 },
    include: { scales: { orderBy: { rawScore: "asc" } } }
  });
  expect(scheme.scales).toHaveLength(81);
  const test = await prisma.test.create({ data: {
    title: "Scoring v2 real content integration", slug: `scoring-v2-${randomUUID()}`,
    price: 0, durationMinutes: authentic ? 120 : 30, mode: authentic ? "CE_CT" : "TRAINING",
    examMode: authentic ? "RIKZ_RUSSIAN_2026" : "GENERIC", subjectCode: "russian", officialYear: 2026,
    scoringSchemeId: authentic ? scheme.id : null, showScaledScore: authentic, createdByAdminId: admin.id
  } });
  ownedTestIds.push(test.id);
  if (authentic) {
    cookieState.values.set("admin_session", createAdminSessionToken({ userId: admin.id, email: admin.email, role: "ADMIN" }));
    const form = new FormData();
    form.set("file", new File([readFileSync(contentFile)], "questions.import.csv", { type: "text/csv" }));
    form.set("mode", "replace");
    const validation = await validateUpload(new Request("http://scoring.test/import", { method: "POST", body: form }), {
      params: Promise.resolve({ testId: test.id })
    });
    const validationBody = await validation.json();
    expect(validation.status, JSON.stringify(validationBody)).toBe(201);
    expect(validationBody.data).toMatchObject({ status: "validated", totalRows: 40, validRows: 40, errors: [] });
    const committed = await commitUpload(new Request("http://scoring.test/import/commit", { method: "POST" }), {
      params: Promise.resolve({ importJobId: validationBody.data.id as string })
    });
    expect(committed.status).toBe(200);
    expect((await committed.json()).data.status).toBe("imported");
    const duplicateCommit = await commitUpload(new Request("http://scoring.test/import/commit", { method: "POST" }), {
      params: Promise.resolve({ importJobId: validationBody.data.id as string })
    });
    expect(duplicateCommit.status).toBe(409);
    const forPublish = await prisma.test.findUniqueOrThrow({ where: { id: test.id }, include: {
      questions: { where: { deletedAt: null } }, scoringScheme: { include: { scales: true } }
    } });
    expect(forPublish).toMatchObject({ questionsCount: 40, maxRawScore: 80 });
    expect(runPublishCheck(forPublish).errors).toEqual([]);
  } else {
    await prisma.question.createMany({ data: [
      { testId: test.id, questionText: "Generic multiple", questionType: "MULTIPLE_CHOICE", optionA: "A", optionB: "B", optionC: "C", correctAnswer: "A,C", topic: "Generic", points: 2, orderIndex: 1 },
      { testId: test.id, questionText: "Generic exact", questionType: "SHORT_TEXT", correctAnswer: "ёж;ежи", topic: "Generic", points: 2, orderIndex: 2 }
    ] });
    await prisma.test.update({ where: { id: test.id }, data: { questionsCount: 2, maxRawScore: 4 } });
  }
  await prisma.test.update({ where: { id: test.id }, data: { status: "PUBLISHED" } });
  const access = await prisma.access.create({ data: {
    userId: user.id, testId: test.id, source: "MANUAL", attemptsTotal: 2, attemptsAvailable: 2,
    expiresAt: new Date(Date.now() + 86_400_000), createdByAdminId: admin.id
  } });
  const started = await startOrRestoreAttempt({ studentId: user.id, email: user.email, testId: test.id, authorizedAccessId: access.id });
  return { admin, user, test, access, started: started.attempt, snapshot: parseTestSnapshot(started.attempt.testSnapshot), scheme };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;
function identity(fixture: Fixture) {
  return { attemptId: fixture.started.id, studentId: fixture.user.id, authorizedAccessId: fixture.access.id };
}
function keyFor(question: SnapshotQuestion) {
  const accepted = question.acceptedAnswers;
  return Array.isArray(accepted) && typeof accepted[0] === "string" ? accepted[0] : question.correctAnswer;
}
async function answerAll(fixture: Fixture, answerFor: (question: SnapshotQuestion) => string) {
  for (const question of fixture.snapshot.questions) {
    await saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: question.snapshotQuestionId, selectedAnswer: answerFor(question) });
  }
}
async function storedResult(fixture: Fixture) {
  return prisma.attempt.findUniqueOrThrow({ where: { id: fixture.started.id }, include: { answers: { orderBy: { snapshotQuestionId: "asc" } } } });
}
function publicResult(fixture: Fixture, stored: Awaited<ReturnType<typeof storedResult>>, raw: number, a: number, b: number) {
  expect(serializeResult(stored)).toEqual({
    status: stored.status.toLowerCase(), mode: "ce_ct", exam_mode: "rikz_russian_2026",
    raw_score: raw, max_raw_score: 80, part_a_score: a, part_a_max_score: 36,
    part_b_score: b, part_b_max_score: 44, completed_at: stored.finishedAt?.toISOString()
  });
  expect(stored.answers).toHaveLength(fixture.snapshot.questions.length);
}

withDatabase("authentic scoring v2: real import, persistence and attempt services", () => {
  beforeAll(() => {
    requireDedicatedSchema();
    previousSessionSecret = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "scoring-v2-isolated-test-session-secret-123456";
  });
  afterEach(async () => {
    cookieState.values.clear();
    if (ownedTestIds.length > 0) {
      await prisma.answer.deleteMany({ where: { attempt: { testId: { in: ownedTestIds } } } });
      await prisma.attempt.deleteMany({ where: { testId: { in: ownedTestIds } } });
      await prisma.eventLog.deleteMany({ where: { actorUserId: { in: ownedUserIds } } });
      await prisma.access.deleteMany({ where: { testId: { in: ownedTestIds } } });
      await prisma.importJob.deleteMany({ where: { testId: { in: ownedTestIds } } });
      await prisma.question.deleteMany({ where: { testId: { in: ownedTestIds } } });
      await prisma.test.deleteMany({ where: { id: { in: ownedTestIds } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: ownedUserIds } } });
    ownedTestIds.length = 0; ownedUserIds.length = 0;
  });
  afterAll(async () => {
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
    await prisma.$disconnect();
  });

  it("imports all 40 keys, scores 80/80 and keeps the authentic aggregate-only contract", async () => {
    const fixture = await createFixture();
    expect(fixture.snapshot.scoringVersion).toBe(2);
    expect(fixture.snapshot.questions.filter((q) => q.officialPart === "A" && q.partialPolicy === "set_partial")).toHaveLength(18);
    expect(fixture.snapshot.questions.filter((q) => q.officialPart === "B" && q.partialPolicy !== "exact_match")).toHaveLength(9);
    expect(fixture.snapshot.questions.filter((q) => q.officialPart === "B" && q.partialPolicy === "exact_match")).toHaveLength(13);
    for (const question of fixture.snapshot.questions) {
      const active = serializeQuestionForStudent(question);
      expect(active).not.toHaveProperty("correctAnswer");
      expect(active).not.toHaveProperty("acceptedAnswers");
      expect(active).not.toHaveProperty("explanation");
      expect(active).not.toHaveProperty("normalizationPolicy");
    }
    await answerAll(fixture, (question) => {
      if (question.officialPart === "B" && question.officialNumber === 4) return "  ПРИЛЕТА  "; // explicit е alternative
      const key = keyFor(question);
      return question.partialPolicy === "set_partial" ? key.replace(/,/g, "").split("").reverse().join("") : key;
    });
    const completed = await completeAttempt({ ...identity(fixture), expire: false });
    expect(completed).toMatchObject({ status: "COMPLETED", rawScore: 80, maxRawScore: 80, scaledScore: 100 });
    const stored = await storedResult(fixture);
    expect(stored.answers.every((answer) => answer.pointsEarned === 2 && answer.isCorrect)).toBe(true);
    publicResult(fixture, stored, 80, 36, 44);
    const schemeAfter = await prisma.scoringScale.findMany({ where: { scoringSchemeId: fixture.scheme.id }, orderBy: { rawScore: "asc" } });
    expect(schemeAfter.map(({ rawScore, scaledScore }) => [rawScore, scaledScore])).toEqual(fixture.scheme.scales.map(({ rawScore, scaledScore }) => [rawScore, scaledScore]));
  }, 30_000);

  it("gives 18 A partial points plus 9 B partial points and zero for 13 incorrect exact answers", async () => {
    const fixture = await createFixture();
    await answerAll(fixture, (question) => {
      const key = keyFor(question);
      if (question.partialPolicy === "set_partial") return key.replace(/,/g, "").slice(1);
      if (question.partialPolicy === "matching_partial") return `${key[0]}${key[1] === "1" ? "2" : "1"}${key.slice(2)}`;
      return "ошибка";
    });
    await completeAttempt({ ...identity(fixture), expire: false });
    const stored = await storedResult(fixture);
    expect(stored).toMatchObject({ rawScore: 27, scaledScore: 38 });
    for (const question of fixture.snapshot.questions) {
      expect(stored.answers.find((answer) => answer.snapshotQuestionId === question.snapshotQuestionId)?.pointsEarned).toBe(question.partialPolicy === "exact_match" ? 0 : 1);
    }
    publicResult(fixture, stored, 27, 18, 9);
  }, 30_000);

  it("never repairs duplicate sets, incomplete matching or hidden extra characters into correct answers", async () => {
    const fixture = await createFixture();
    await answerAll(fixture, (question) => {
      const key = keyFor(question);
      if (question.partialPolicy === "set_partial") return key + key.replace(/,/g, "")[0];
      if (question.partialPolicy === "matching_partial") return key.slice(0, -2);
      return `${key}\u200b`;
    });
    await completeAttempt({ ...identity(fixture), expire: false });
    const stored = await storedResult(fixture);
    expect(stored).toMatchObject({ rawScore: 0, scaledScore: 0 });
    expect(stored.answers.every((answer) => answer.pointsEarned === 0 && !answer.isCorrect)).toBe(true);
    publicResult(fixture, stored, 0, 0, 0);
  }, 30_000);

  it("restores unfinished raw input and freezes metadata against subsequent question edits", async () => {
    const fixture = await createFixture();
    const question = fixture.snapshot.questions.find((q) => q.officialPart === "B" && q.officialNumber === 19)!;
    const raw = "  А2Б3В";
    await saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: question.snapshotQuestionId, selectedAnswer: raw });
    const restored = await startOrRestoreAttempt({ studentId: fixture.user.id, email: fixture.user.email, testId: fixture.test.id, authorizedAccessId: fixture.access.id });
    expect(restored.restored).toBe(true);
    expect(restored.attempt.id).toBe(fixture.started.id);
    expect(restored.attempt.answers.find((answer) => answer.snapshotQuestionId === question.snapshotQuestionId)?.selectedAnswer).toBe(raw);
    expect((await prisma.access.findUniqueOrThrow({ where: { id: fixture.access.id } })).attemptsAvailable).toBe(1);
    await prisma.question.update({ where: { id: question.originalQuestionId }, data: {
      correctAnswer: "инойключ", acceptedAnswers: ["инойключ"], partialPolicy: "exact_match",
      normalizationPolicy: { version: 1, kind: "exact", subtype: "word" }
    } });
    await saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: question.snapshotQuestionId, selectedAnswer: keyFor(question) });
    await completeAttempt({ ...identity(fixture), expire: false });
    const stored = await storedResult(fixture);
    expect(stored.rawScore).toBe(2);
    expect(parseTestSnapshot(stored.testSnapshot)).toEqual(fixture.snapshot);
    expect(stored.answers.find((answer) => answer.snapshotQuestionId === question.snapshotQuestionId)?.pointsEarned).toBe(2);
  }, 30_000);

  it("upgrades old published metadata only for a new attempt", async () => {
    const fixture = await createFixture();
    await completeAttempt({ ...identity(fixture), expire: false });
    await prisma.question.updateMany({ where: { testId: fixture.test.id }, data: {
      partialPolicy: null, normalizationPolicy: Prisma.DbNull
    } });
    const next = await startOrRestoreAttempt({ studentId: fixture.user.id, email: fixture.user.email, testId: fixture.test.id, authorizedAccessId: fixture.access.id });
    const newSnapshot = parseTestSnapshot(next.attempt.testSnapshot);
    expect(newSnapshot.scoringVersion).toBe(2);
    expect(newSnapshot.questions.filter((question) => question.partialPolicy === "set_partial")).toHaveLength(23);
    const b1 = newSnapshot.questions.find((question) => question.officialPart === "B" && question.officialNumber === 1)!;
    await saveAttemptAnswer({ attemptId: next.attempt.id, studentId: fixture.user.id, snapshotQuestionId: b1.snapshotQuestionId, selectedAnswer: "3" });
    const completed = await completeAttempt({ attemptId: next.attempt.id, studentId: fixture.user.id, expire: false });
    expect(completed.rawScore).toBe(1);
    expect(parseTestSnapshot((await storedResult(fixture)).testSnapshot)).toEqual(fixture.snapshot);
  }, 30_000);

  it("rejects broken configuration at start without consuming an attempt", async () => {
    const fixture = await createFixture();
    await completeAttempt({ ...identity(fixture), expire: false });
    await prisma.question.update({ where: { id: fixture.snapshot.questions[0].originalQuestionId }, data: {
      normalizationPolicy: { version: 999, kind: "set", alphabet: "ABCDE" }
    } });
    const available = (await prisma.access.findUniqueOrThrow({ where: { id: fixture.access.id } })).attemptsAvailable;
    await expect(startOrRestoreAttempt({ studentId: fixture.user.id, email: fixture.user.email, testId: fixture.test.id, authorizedAccessId: fixture.access.id }))
      .rejects.toThrow("TEST_SCORING_CONFIGURATION_INVALID");
    expect((await prisma.access.findUniqueOrThrow({ where: { id: fixture.access.id } })).attemptsAvailable).toBe(available);
    expect(await prisma.attempt.count({ where: { testId: fixture.test.id } })).toBe(1);
  }, 30_000);

  it("persists a terminal result once and never regrades on repeated completion or result reads", async () => {
    const fixture = await createFixture();
    await answerAll(fixture, keyFor);
    await completeAttempt({ ...identity(fixture), expire: false });
    const before = await storedResult(fixture);
    await prisma.question.updateMany({ where: { testId: fixture.test.id }, data: { correctAnswer: "changed-after-completion", acceptedAnswers: ["changed-after-completion"] } });
    const again = await completeAttempt({ ...identity(fixture), expire: false });
    const expiredAgain = await completeAttempt({ ...identity(fixture), expire: true });
    expect(again.rawScore).toBe(80); expect(expiredAgain.status).toBe("COMPLETED");
    const after = await storedResult(fixture);
    expect(after.finishedAt).toEqual(before.finishedAt);
    expect(after.answers).toEqual(before.answers);
    publicResult(fixture, after, 80, 36, 44);
    expect(await prisma.eventLog.count({ where: { entityId: fixture.started.id, eventType: "attempt_completed" } })).toBe(1);
    await expect(saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: "q_1", selectedAnswer: "A" })).rejects.toThrow("ATTEMPT_FINISHED");
  }, 30_000);

  it("uses the same scoring on timer expiry, rejects late saves, and stores the deadline as finishedAt", async () => {
    const fixture = await createFixture();
    await answerAll(fixture, keyFor);
    await expect(completeAttempt({ ...identity(fixture), expire: true })).rejects.toThrow("ATTEMPT_TIME_NOT_EXPIRED");
    const startedAt = new Date(Date.now() - 3 * 60 * 60_000);
    await prisma.attempt.update({ where: { id: fixture.started.id }, data: { startedAt } });
    await expect(saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: "q_1", selectedAnswer: "A" })).rejects.toThrow("ATTEMPT_TIME_EXPIRED");
    const expired = await completeAttempt({ ...identity(fixture), expire: true });
    expect(expired).toMatchObject({ status: "EXPIRED", rawScore: 80, scaledScore: 100 });
    expect(expired.finishedAt).toEqual(new Date(startedAt.getTime() + 120 * 60_000));
    publicResult(fixture, await storedResult(fixture), 80, 36, 44);
    await expect(saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: "q_1", selectedAnswer: "A" })).rejects.toThrow("ATTEMPT_FINISHED");
  }, 30_000);

  it("leaves old snapshot B scoring unchanged instead of upgrading an already started attempt", async () => {
    const fixture = await createFixture();
    const oldSnapshot = { ...fixture.snapshot };
    delete oldSnapshot.scoringVersion;
    await prisma.attempt.update({ where: { id: fixture.started.id }, data: { testSnapshot: oldSnapshot as unknown as Prisma.InputJsonValue } });
    const b1 = fixture.snapshot.questions.find((q) => q.officialPart === "B" && q.officialNumber === 1)!;
    const b19 = fixture.snapshot.questions.find((q) => q.officialPart === "B" && q.officialNumber === 19)!;
    await saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: b1.snapshotQuestionId, selectedAnswer: "3" });
    await saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: b19.snapshotQuestionId, selectedAnswer: "А1Б3В1Г4" });
    await completeAttempt({ ...identity(fixture), expire: false });
    const stored = await storedResult(fixture);
    expect(stored.rawScore).toBe(0);
    expect(parseTestSnapshot(stored.testSnapshot).scoringVersion).toBeUndefined();
  }, 30_000);

  it("keeps generic scoring and restoration unchanged", async () => {
    const fixture = await createFixture(false);
    expect(fixture.snapshot.scoringVersion).toBeUndefined();
    await saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: "q_1", selectedAnswer: "A" });
    await saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: "q_2", selectedAnswer: "  ЕЖИ  " });
    const restored = await getAttemptForStudent(identity(fixture));
    expect(restored?.answers.find((answer) => answer.snapshotQuestionId === "q_2")?.selectedAnswer).toBe("ежи");
    const completed = await completeAttempt({ ...identity(fixture), expire: false });
    expect(completed).toMatchObject({ rawScore: 3, maxRawScore: 4, scaledScore: null });
    const stored = await storedResult(fixture);
    expect(stored.answers.find((answer) => answer.snapshotQuestionId === "q_1")?.pointsEarned).toBe(1);
    expect(stored.answers.find((answer) => answer.snapshotQuestionId === "q_2")?.pointsEarned).toBe(2);
  }, 30_000);

  it("keeps stored scores consistent when saving races completion and completion is retried", async () => {
    const fixture = await createFixture();
    const b1 = fixture.snapshot.questions.find((q) => q.officialPart === "B" && q.officialNumber === 1)!;
    // On native PostgreSQL this exercises the shared attempt row lock. PGlite's
    // single connection proves service consistency only, not lock contention.
    const [saved, completed] = await Promise.allSettled([
      saveAttemptAnswer({ ...identity(fixture), snapshotQuestionId: b1.snapshotQuestionId, selectedAnswer: "35" }),
      completeAttempt({ ...identity(fixture), expire: false })
    ]);
    expect(completed.status).toBe("fulfilled");
    if (saved.status === "rejected") expect(saved.reason).toMatchObject({ message: "ATTEMPT_FINISHED" });
    const stored = await storedResult(fixture);
    expect(stored.status).toBe("COMPLETED");
    expect(stored.rawScore).toBe(saved.status === "fulfilled" ? 2 : 0);
    expect(stored.answers.reduce((sum, answer) => sum + (answer.pointsEarned ?? 0), 0)).toBe(stored.rawScore);
    const repeated = await completeAttempt({ ...identity(fixture), expire: false });
    expect(repeated.rawScore).toBe(stored.rawScore);
    expect((await storedResult(fixture)).answers).toEqual(stored.answers);
  }, 30_000);
});
