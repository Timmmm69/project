import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_TEST_SLUG = "demo-russian-language-online-test";

const demoQuestions = [
  {
    questionText: "Укажите слово, в котором пишется буква О.",
    questionType: "SINGLE_CHOICE",
    optionA: "з..ря",
    optionB: "к..снуться",
    optionC: "пл..вец",
    optionD: "р..сток",
    correctAnswer: "D",
    topic: "Орфография",
    subtopic: "Чередующиеся гласные",
    difficulty: "MEDIUM",
    points: 1,
    explanation: "Демо-вопрос для проверки интерфейса. Не является финальным учебным материалом.",
    source: "DEMO ONLY"
  },
  {
    questionText: "Выберите варианты, где на месте пропуска пишется НН.",
    questionType: "MULTIPLE_CHOICE",
    optionA: "деревя..ый дом",
    optionB: "ране..ый боец",
    optionC: "стекля..ая дверь",
    optionD: "жаре..ая картошка",
    correctAnswer: "A,C",
    topic: "Орфография",
    subtopic: "Н и НН",
    difficulty: "HARD",
    points: 2,
    explanation: "Демо-вопрос: multiple_choice засчитывается только при полном совпадении набора.",
    source: "DEMO ONLY"
  },
  {
    questionText: "Введите форму слова: прийти в прошедшем времени, мужской род.",
    questionType: "SHORT_TEXT",
    optionA: null,
    optionB: null,
    optionC: null,
    optionD: null,
    correctAnswer: "пришёл;пришел",
    topic: "Грамматика",
    subtopic: "Формы глагола",
    difficulty: "EASY",
    points: 1,
    explanation: "Для short_text можно указать несколько допустимых вариантов через точку с запятой.",
    source: "DEMO ONLY"
  },
  {
    questionText: "Укажите предложение, в котором нужна запятая перед союзом И.",
    questionType: "SINGLE_CHOICE",
    optionA: "Солнце взошло и птицы запели.",
    optionB: "Мы читали и обсуждали текст.",
    optionC: "Он быстро и уверенно ответил.",
    optionD: "Ветер стих и стало тихо.",
    correctAnswer: "A",
    topic: "Пунктуация",
    subtopic: "Сложносочинённое предложение",
    difficulty: "MEDIUM",
    points: 1,
    explanation: "Демо-вопрос для проверки темы Пунктуация.",
    source: "DEMO ONLY"
  },
  {
    questionText: "Выберите словосочетания с грамматической ошибкой.",
    questionType: "MULTIPLE_CHOICE",
    optionA: "более красивее",
    optionB: "согласно расписанию",
    optionC: "ихний ответ",
    optionD: "около пяти книг",
    correctAnswer: "A,C",
    topic: "Грамматика",
    subtopic: "Нормы формы слова",
    difficulty: "MEDIUM",
    points: 2,
    explanation: "Демо-вопрос для проверки нескольких правильных ответов.",
    source: "DEMO ONLY"
  },
  {
    questionText: "Введите синоним к слову 'смелый' одним словом.",
    questionType: "SHORT_TEXT",
    optionA: null,
    optionB: null,
    optionC: null,
    optionD: null,
    correctAnswer: "храбрый;отважный",
    topic: "Лексика",
    subtopic: "Синонимы",
    difficulty: "EASY",
    points: 1,
    explanation: "Демо-вопрос для проверки короткого текстового ответа.",
    source: "DEMO ONLY"
  },
  {
    questionText: "Укажите слово с приставкой ПРЕ-.",
    questionType: "SINGLE_CHOICE",
    optionA: "пр..морский",
    optionB: "пр..кратить",
    optionC: "пр..шить",
    optionD: "пр..открыть",
    correctAnswer: "B",
    topic: "Орфография",
    subtopic: "Пре/при",
    difficulty: "MEDIUM",
    points: 1,
    explanation: "Демо-вопрос для проверки вариантов A-D.",
    source: "DEMO ONLY"
  },
  {
    questionText: "Выберите предложения, где нужна запятая при причастном обороте.",
    questionType: "MULTIPLE_CHOICE",
    optionA: "Книга прочитанная вчера лежала на столе.",
    optionB: "Прочитанная вчера книга лежала на столе.",
    optionC: "Дом построенный у реки был виден издалека.",
    optionD: "Построенный у реки дом был виден издалека.",
    correctAnswer: "A,C",
    topic: "Пунктуация",
    subtopic: "Причастный оборот",
    difficulty: "HARD",
    points: 2,
    explanation: "Демо-вопрос для проверки темы и подтемы.",
    source: "DEMO ONLY"
  },
  {
    questionText: "Введите слово без ошибки: 'интел..генция'.",
    questionType: "SHORT_TEXT",
    optionA: null,
    optionB: null,
    optionC: null,
    optionD: null,
    correctAnswer: "интеллигенция",
    topic: "Лексика",
    subtopic: "Словарные слова",
    difficulty: "MEDIUM",
    points: 1,
    explanation: null,
    source: "DEMO ONLY"
  },
  {
    questionText: "Укажите грамматически правильное продолжение предложения: 'Подъезжая к станции, ...'",
    questionType: "SINGLE_CHOICE",
    optionA: "у меня слетела шляпа.",
    optionB: "пассажиры стали собирать вещи.",
    optionC: "поезд замедлил ход.",
    optionD: "мне стало радостно.",
    correctAnswer: "B",
    topic: "Грамматика",
    subtopic: "Деепричастный оборот",
    difficulty: "MEDIUM",
    points: 1,
    explanation: "Демо-вопрос для проверки грамматической нормы.",
    source: "DEMO ONLY"
  }
];

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || "admin@example.com";
  const admin = await prisma.user.findFirst({
    where: {
      email: adminEmail,
      role: "ADMIN",
      deletedAt: null
    },
    select: {
      id: true,
      email: true
    }
  });

  if (!admin) {
    throw new Error(`Admin ${adminEmail} not found. Run pnpm seed:admin first.`);
  }

  const test = await prisma.$transaction(async (tx) => {
    const upsertedTest = await tx.test.upsert({
      where: { slug: DEMO_TEST_SLUG },
      create: {
        title: "DEMO ONLY — Русский язык. Онлайн-тесты",
        slug: DEMO_TEST_SLUG,
        subject: "RUSSIAN",
        mode: "TRAINING",
        shortDescription: "Демонстрационный тест для проверки разработки. Не финальный учебный контент.",
        fullDescription:
          "Технический demo-content для проверки flow и UI. Не использовать как реальный учебный или экзаменационный материал.",
        price: 0,
        currency: "BYN",
        durationMinutes: 30,
        attemptsLimit: 1,
        accessDays: 7,
        status: "DRAFT",
        createdByAdminId: admin.id
      },
      update: {
        title: "DEMO ONLY — Русский язык. Онлайн-тесты",
        shortDescription: "Демонстрационный тест для проверки разработки. Не финальный учебный контент.",
        fullDescription:
          "Технический demo-content для проверки flow и UI. Не использовать как реальный учебный или экзаменационный материал.",
        price: 0,
        currency: "BYN",
        durationMinutes: 30,
        attemptsLimit: 1,
        accessDays: 7,
        status: "DRAFT",
        deletedAt: null,
        createdByAdminId: admin.id
      }
    });

    await tx.question.updateMany({
      where: {
        testId: upsertedTest.id,
        source: "DEMO ONLY",
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    });

    await tx.question.createMany({
      data: demoQuestions.map((question, index) => ({
        ...question,
        testId: upsertedTest.id,
        orderIndex: index + 1,
        scoringRule: question.questionType === "SHORT_TEXT" ? "EXACT_TEXT" : "FULL_MATCH"
      }))
    });

    const aggregate = await tx.question.aggregate({
      where: {
        testId: upsertedTest.id,
        deletedAt: null
      },
      _count: {
        _all: true
      },
      _sum: {
        points: true
      }
    });

    return tx.test.update({
      where: { id: upsertedTest.id },
      data: {
        questionsCount: aggregate._count._all,
        maxRawScore: aggregate._sum.points ?? 0
      }
    });
  });

  await prisma.eventLog.create({
    data: {
      actorUserId: admin.id,
      eventType: "demo_content_seeded",
      entityType: "test",
      entityId: test.id,
      payload: {
        slug: test.slug,
        questionsCount: test.questionsCount,
        note: "DEMO ONLY — not final educational content"
      }
    }
  });

  console.log(`Seeded demo test ${test.slug} with ${test.questionsCount} questions.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
