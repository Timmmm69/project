"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin";
};

type TestItem = {
  id: string;
  title: string;
  slug: string;
  mode: "training" | "ce_ct";
  status: "draft" | "published" | "hidden" | "archived";
  price: number;
  currency: string;
  durationMinutes: number;
  questionsCount: number;
  maxRawScore: number;
};

type QuestionItem = {
  id: string;
  questionText: string;
  questionType: "single_choice" | "multiple_choice" | "short_text";
  optionA: string | null;
  optionB: string | null;
  optionC: string | null;
  optionD: string | null;
  correctAnswer: string;
  topic: string;
  subtopic: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  points: number;
  explanation: string | null;
  orderIndex: number;
};

type ImportIssue = {
  rowNumber: number | null;
  field?: string;
  code: string;
  message: string;
};

type ImportPreviewQuestion = {
  questionText: string;
  questionType: "single_choice" | "multiple_choice" | "short_text";
  correctAnswer: string;
  topic: string;
  points: number;
};

type ImportJobResult = {
  id: string;
  mode: "append" | "replace";
  status: "validated" | "failed" | "imported" | "uploaded" | "cancelled";
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  preview: ImportPreviewQuestion[];
};

type PaymentItem = {
  id: string;
  email: string;
  testTitle: string;
  amount: number;
  currency: string;
  status: string;
  provider: string;
  providerPaymentId: string | null;
  providerInvoiceId: string | null;
  providerAccountNumber: string | null;
  providerStatus: string | null;
  accessId: string | null;
  accessCreated: boolean;
  npdReceiptRequired: boolean;
  npdReceiptCreated: boolean;
  npdReceiptCreatedAt: string | null;
  createdAt: string;
};

type AccessItem = {
  id: string;
  email: string;
  testTitle: string;
  source: string;
  attemptsTotal: number;
  attemptsAvailable: number;
  expiresAt: string;
  revokedAt: string | null;
};

type AccessCodeItem = {
  id: string;
  testTitle: string;
  status: string;
  attemptsTotal: number;
  accessDays: number;
  codeExpiresAt: string;
  activatedByEmail: string | null;
  activatedAt: string | null;
  revokedAt: string | null;
  comment: string | null;
};

type AttemptItem = {
  id: string;
  email: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  rawScore: number | null;
  maxRawScore: number | null;
  percent: number | null;
  level: string | null;
  scaledScore: number | null;
};

type ApiSuccess<T> = {
  success: true;
  data: T;
};

type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

const emptyCreateForm = {
  title: "",
  mode: "training",
  price: "0",
  durationMinutes: "60",
  attemptsLimit: "1",
  accessDays: "7",
  shortDescription: ""
};

const emptyQuestionForm = {
  questionText: "",
  questionType: "single_choice",
  optionA: "",
  optionB: "",
  optionC: "",
  optionD: "",
  correctAnswer: "",
  topic: "Орфография",
  subtopic: "",
  difficulty: "medium",
  points: "1",
  explanation: ""
};

const emptyManualAccessForm = {
  email: "",
  attemptsTotal: "1",
  accessDays: "7",
  comment: ""
};

const emptyAccessCodeForm = {
  attemptsTotal: "1",
  accessDays: "7",
  codeExpiresDays: "30",
  comment: ""
};

async function readJson<T>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toFixed(2)} ${currency}`;
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (["published", "active", "success", "completed"].includes(normalized)) {
    return "status-pill success";
  }
  if (["draft", "pending", "started"].includes(normalized)) {
    return "status-pill pending";
  }
  if (["hidden", "archived", "revoked", "failed", "expired", "cancelled"].includes(normalized)) {
    return "status-pill failed";
  }
  return "status-pill";
}

export function AdminDashboard() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [questionForm, setQuestionForm] = useState(emptyQuestionForm);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importJob, setImportJob] = useState<ImportJobResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [accesses, setAccesses] = useState<AccessItem[]>([]);
  const [accessCodes, setAccessCodes] = useState<AccessCodeItem[]>([]);
  const [attempts, setAttempts] = useState<AttemptItem[]>([]);
  const [manualAccessForm, setManualAccessForm] = useState(emptyManualAccessForm);
  const [accessCodeForm, setAccessCodeForm] = useState(emptyAccessCodeForm);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  const selectedTest = useMemo(
    () => tests.find((test) => test.id === selectedTestId) ?? null,
    [selectedTestId, tests]
  );
  const publishedCount = useMemo(() => tests.filter((test) => test.status === "published").length, [tests]);
  const activeAccessCount = useMemo(() => accesses.filter((access) => !access.revokedAt).length, [accesses]);
  const completedAttemptCount = useMemo(
    () => attempts.filter((attempt) => attempt.status === "completed" || attempt.status === "expired").length,
    [attempts]
  );

  async function loadTests(nextSelectedTestId = selectedTestId) {
    const response = await fetch("/api/admin/tests?limit=50");
    const body = await readJson<{ items: TestItem[] }>(response);
    if (body.success) {
      setTests(body.data.items);
      if (nextSelectedTestId && body.data.items.some((test) => test.id === nextSelectedTestId)) {
        setSelectedTestId(nextSelectedTestId);
      }
    }
  }

  async function loadQuestions(testId: string) {
    const response = await fetch(`/api/admin/tests/${testId}/questions`);
    const body = await readJson<{ items: QuestionItem[] }>(response);
    if (body.success) {
      setQuestions(body.data.items);
    }
  }

  async function loadAdminAccessData(testId: string) {
    const [paymentsResponse, accessesResponse, codesResponse, attemptsResponse] = await Promise.all([
      fetch(`/api/admin/payments?testId=${testId}&limit=20`),
      fetch(`/api/admin/accesses?testId=${testId}&limit=20`),
      fetch(`/api/admin/access-codes?testId=${testId}&limit=20`),
      fetch(`/api/admin/attempts?testId=${testId}&limit=20`)
    ]);
    const [paymentsBody, accessesBody, codesBody, attemptsBody] = await Promise.all([
      readJson<{ items: PaymentItem[] }>(paymentsResponse),
      readJson<{ items: AccessItem[] }>(accessesResponse),
      readJson<{ items: AccessCodeItem[] }>(codesResponse),
      readJson<{ items: AttemptItem[] }>(attemptsResponse)
    ]);

    if (paymentsBody.success) {
      setPayments(paymentsBody.data.items);
    }
    if (accessesBody.success) {
      setAccesses(accessesBody.data.items);
    }
    if (codesBody.success) {
      setAccessCodes(codesBody.data.items);
    }
    if (attemptsBody.success) {
      setAttempts(attemptsBody.data.items);
    }
  }

  async function loadMe() {
    const response = await fetch("/api/admin/auth/me");
    const body = await readJson<{ user: AdminUser }>(response);
    if (body.success) {
      setUser(body.data.user);
      await loadTests();
    } else {
      setUser(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadMe();
  }, []);

  useEffect(() => {
    setImportJob(null);
    setImportFile(null);
    setCreatedCode(null);
    if (selectedTestId) {
      void loadQuestions(selectedTestId);
      void loadAdminAccessData(selectedTestId);
    } else {
      setQuestions([]);
      setPayments([]);
      setAccesses([]);
      setAccessCodes([]);
      setAttempts([]);
    }
  }, [selectedTestId]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch("/api/admin/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginForm)
    });
    const body = await readJson<{ user: AdminUser }>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setUser(body.data.user);
    setLoginForm({ email: "", password: "" });
    await loadTests();
  }

  async function handleLogout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    setUser(null);
    setTests([]);
    setQuestions([]);
    setAttempts([]);
    setSelectedTestId(null);
  }

  async function handleCreateTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const response = await fetch("/api/admin/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: createForm.title,
        mode: createForm.mode,
        price: Number(createForm.price),
        currency: "BYN",
        durationMinutes: Number(createForm.durationMinutes),
        attemptsLimit: Number(createForm.attemptsLimit),
        accessDays: Number(createForm.accessDays),
        shortDescription: createForm.shortDescription || undefined
      })
    });
    const body = await readJson<TestItem>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setCreateForm(emptyCreateForm);
    setSelectedTestId(body.data.id);
    await loadTests(body.data.id);
  }

  async function handleCreateQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTestId) {
      return;
    }
    setMessage(null);

    const response = await fetch(`/api/admin/tests/${selectedTestId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionText: questionForm.questionText,
        questionType: questionForm.questionType,
        optionA: questionForm.optionA || null,
        optionB: questionForm.optionB || null,
        optionC: questionForm.optionC || null,
        optionD: questionForm.optionD || null,
        correctAnswer: questionForm.correctAnswer,
        topic: questionForm.topic,
        subtopic: questionForm.subtopic || null,
        difficulty: questionForm.difficulty,
        points: Number(questionForm.points),
        explanation: questionForm.explanation || null
      })
    });
    const body = await readJson<QuestionItem>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setQuestionForm(emptyQuestionForm);
    await loadQuestions(selectedTestId);
    await loadTests(selectedTestId);
  }

  async function handleValidateImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTestId || !importFile) {
      setMessage("Выберите файл импорта.");
      return;
    }

    setImportBusy(true);
    setMessage(null);
    setImportJob(null);

    const formData = new FormData();
    formData.set("file", importFile);
    formData.set("mode", importMode);

    const response = await fetch(`/api/admin/tests/${selectedTestId}/import/validate`, {
      method: "POST",
      body: formData
    });
    const body = await readJson<ImportJobResult>(response);
    setImportBusy(false);

    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setImportJob(body.data);
    setMessage(
      body.data.errors.length > 0
        ? "Файл проверен, но есть критические ошибки. Commit заблокирован."
        : "Файл проверен. Можно применить импорт."
    );
  }

  async function handleCommitImport() {
    if (!selectedTestId || !importJob || importJob.errors.length > 0) {
      return;
    }
    if (importJob.mode === "replace" && !confirm("Replace удалит текущие активные вопросы теста и добавит вопросы из файла. Продолжить?")) {
      return;
    }

    setImportBusy(true);
    setMessage(null);
    const response = await fetch(`/api/admin/import/${importJob.id}/commit`, { method: "POST" });
    const body = await readJson<ImportJobResult>(response);
    setImportBusy(false);

    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setImportJob(body.data);
    setMessage("Импорт применён.");
    await loadQuestions(selectedTestId);
    await loadTests(selectedTestId);
  }

  async function handleCreateManualAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTestId) {
      return;
    }

    setMessage(null);
    const response = await fetch("/api/admin/accesses/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: manualAccessForm.email,
        testId: selectedTestId,
        attemptsTotal: Number(manualAccessForm.attemptsTotal),
        accessDays: Number(manualAccessForm.accessDays),
        comment: manualAccessForm.comment || undefined
      })
    });
    const body = await readJson<{ access: AccessItem }>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setManualAccessForm(emptyManualAccessForm);
    setMessage("Доступ выдан вручную.");
    await loadAdminAccessData(selectedTestId);
  }

  async function handleCreateAccessCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTestId) {
      return;
    }

    setMessage(null);
    setCreatedCode(null);
    const response = await fetch("/api/admin/access-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: selectedTestId,
        attemptsTotal: Number(accessCodeForm.attemptsTotal),
        accessDays: Number(accessCodeForm.accessDays),
        codeExpiresDays: Number(accessCodeForm.codeExpiresDays),
        comment: accessCodeForm.comment || undefined
      })
    });
    const body = await readJson<{ accessCode: AccessCodeItem; code: string }>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setAccessCodeForm(emptyAccessCodeForm);
    setCreatedCode(body.data.code);
    setMessage("Код создан. Он показан один раз.");
    await loadAdminAccessData(selectedTestId);
  }

  async function handleRevokeAccess(accessId: string) {
    if (!selectedTestId || !confirm("Отозвать доступ?")) {
      return;
    }

    const response = await fetch(`/api/admin/accesses/${accessId}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Revoked by admin" })
    });
    const body = await readJson<{ access: AccessItem }>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setMessage("Доступ отозван.");
    await loadAdminAccessData(selectedTestId);
  }

  async function handleRevokeAccessCode(accessCodeId: string) {
    if (!selectedTestId || !confirm("Отозвать код доступа?")) {
      return;
    }

    const response = await fetch(`/api/admin/access-codes/${accessCodeId}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Revoked by admin" })
    });
    const body = await readJson<{ accessCode: AccessCodeItem }>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setMessage("Код отозван.");
    await loadAdminAccessData(selectedTestId);
  }

  async function handleMarkNpdReceiptCreated(paymentId: string) {
    const response = await fetch(`/api/admin/payments/${paymentId}/npd-receipt-created`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "NPD receipt created manually" })
    });
    const body = await readJson<{ payment: PaymentItem }>(response);
    if (!body.success) {
      setMessage(body.error.message);
      return;
    }

    setPayments((current) =>
      current.map((payment) => (payment.id === paymentId ? body.data.payment : payment))
    );
    setMessage("NPD receipt marked as created.");
  }

  async function handleQuestionOrder(questionId: string, direction: "up" | "down") {
    if (!selectedTestId) {
      return;
    }

    await fetch(`/api/admin/questions/${questionId}/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction })
    });
    await loadQuestions(selectedTestId);
  }

  async function handleDeleteQuestion(questionId: string) {
    if (!selectedTestId) {
      return;
    }

    await fetch(`/api/admin/questions/${questionId}`, {
      method: "DELETE"
    });
    await loadQuestions(selectedTestId);
    await loadTests(selectedTestId);
  }

  if (loading) {
    return (
      <main className="page-shell">
        <section className="panel">
          <p className="muted">Загрузка</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="page-shell admin-grid">
        <section className="panel stack">
          <div>
            <p className="eyebrow">Админка</p>
            <h1 className="page-title">Вход преподавателя</h1>
          </div>
          <form className="form-stack" onSubmit={handleLogin}>
            <label className="field">
              <span>Email</span>
              <input
                value={loginForm.email}
                onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })}
                type="email"
                required
              />
            </label>
            <label className="field">
              <span>Пароль</span>
              <input
                value={loginForm.password}
                onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
                type="password"
                required
              />
            </label>
            {message ? <p className="form-error">{message}</p> : null}
            <button className="button" type="submit">
              Войти
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell admin-shell stack">
      <section className="toolbar">
        <div>
          <p className="eyebrow">Админка</p>
          <h1 className="page-title">Управление тестами</h1>
          <p className="muted">{user.email}</p>
        </div>
        <button className="button secondary" type="button" onClick={handleLogout}>
          Выйти
        </button>
      </section>

      <section className="admin-overview">
        <article className="metric-card">
          <p className="eyebrow">Тесты</p>
          <h2 className="metric-value">{tests.length}</h2>
          <p className="muted">Опубликовано: {publishedCount}</p>
        </article>
        <article className="metric-card">
          <p className="eyebrow">Выбранный тест</p>
          <h2 className="metric-value">{selectedTest ? selectedTest.questionsCount : "-"}</h2>
          <p className="muted">{selectedTest ? "вопросов" : "выберите тест"}</p>
        </article>
        <article className="metric-card">
          <p className="eyebrow">Доступы</p>
          <h2 className="metric-value">{activeAccessCount}</h2>
          <p className="muted">активных по выбранному тесту</p>
        </article>
        <article className="metric-card">
          <p className="eyebrow">Попытки</p>
          <h2 className="metric-value">{completedAttemptCount}</h2>
          <p className="muted">завершённых</p>
        </article>
      </section>

      <section className="panel stack">
        <h2 className="section-title">Создать тест</h2>
        <form className="form-grid" onSubmit={handleCreateTest}>
          <label className="field wide">
            <span>Название</span>
            <input
              value={createForm.title}
              onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>Режим</span>
            <select
              value={createForm.mode}
              onChange={(event) => setCreateForm({ ...createForm, mode: event.target.value })}
            >
              <option value="training">Тренировочный</option>
              <option value="ce_ct">ЦЭ/ЦТ</option>
            </select>
          </label>
          <label className="field">
            <span>Цена, копейки BYN</span>
            <input
              value={createForm.price}
              onChange={(event) => setCreateForm({ ...createForm, price: event.target.value })}
              type="number"
              min="0"
              required
            />
          </label>
          <label className="field">
            <span>Минуты</span>
            <input
              value={createForm.durationMinutes}
              onChange={(event) => setCreateForm({ ...createForm, durationMinutes: event.target.value })}
              type="number"
              min="1"
              required
            />
          </label>
          <label className="field">
            <span>Попытки</span>
            <input
              value={createForm.attemptsLimit}
              onChange={(event) => setCreateForm({ ...createForm, attemptsLimit: event.target.value })}
              type="number"
              min="1"
              required
            />
          </label>
          <label className="field">
            <span>Дней доступа</span>
            <input
              value={createForm.accessDays}
              onChange={(event) => setCreateForm({ ...createForm, accessDays: event.target.value })}
              type="number"
              min="1"
              required
            />
          </label>
          <label className="field wide">
            <span>Краткое описание</span>
            <textarea
              value={createForm.shortDescription}
              onChange={(event) =>
                setCreateForm({ ...createForm, shortDescription: event.target.value })
              }
              rows={3}
            />
          </label>
          {message ? <p className="form-error wide">{message}</p> : null}
          <button className="button" type="submit">
            Создать
          </button>
        </form>
      </section>

      <section className="panel stack">
        <h2 className="section-title">Тесты</h2>
        {tests.length === 0 ? (
          <p className="muted">Пока нет созданных тестов.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Статус</th>
                  <th>Режим</th>
                  <th>Вопросы</th>
                  <th>Макс. балл</th>
                  <th>Цена</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((test) => (
                  <tr key={test.id}>
                    <td>
                      <div className="table-title">{test.title}</div>
                      <div className="muted">{test.slug}</div>
                    </td>
                    <td><span className={statusClass(test.status)}>{test.status}</span></td>
                    <td>{test.mode === "ce_ct" ? "ЦЭ/ЦТ" : "training"}</td>
                    <td>{test.questionsCount}</td>
                    <td>{test.maxRawScore}</td>
                    <td>{formatMoney(test.price, test.currency)}</td>
                    <td>
                      <button
                        className="button secondary small"
                        type="button"
                        onClick={() => setSelectedTestId(test.id)}
                      >
                        Вопросы
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedTest ? (
        <section className="panel stack">
          <div>
            <p className="eyebrow">Конструктор вопросов</p>
            <h2 className="section-title">{selectedTest.title}</h2>
            <p className="muted">
              Вопросов: {selectedTest.questionsCount}. Максимальный балл: {selectedTest.maxRawScore}.
            </p>
          </div>

          <dl className="meta-grid wide">
            <div>
              <dt>Статус</dt>
              <dd>{selectedTest.status}</dd>
            </div>
            <div>
              <dt>Режим</dt>
              <dd>{selectedTest.mode === "ce_ct" ? "ЦЭ/ЦТ" : "training"}</dd>
            </div>
            <div>
              <dt>Вопросы</dt>
              <dd>{selectedTest.questionsCount}</dd>
            </div>
            <div>
              <dt>Макс. балл</dt>
              <dd>{selectedTest.maxRawScore}</dd>
            </div>
            <div>
              <dt>Цена</dt>
              <dd>{formatMoney(selectedTest.price, selectedTest.currency)}</dd>
            </div>
            <div>
              <dt>Время</dt>
              <dd>{selectedTest.durationMinutes} мин</dd>
            </div>
          </dl>

          <section className="subpanel stack">
            <div>
              <h3 className="subsection-title">Импорт XLSX/CSV</h3>
              <p className="muted">
                Сначала проверьте файл. Вопросы появятся в тесте только после commit.
              </p>
            </div>
            <div className="inline-actions">
              <a className="button secondary small" href="/api/admin/import/template?format=xlsx">
                Скачать XLSX шаблон
              </a>
              <a className="button secondary small" href="/api/admin/import/template?format=csv">
                Скачать CSV шаблон
              </a>
            </div>
            <form className="form-grid" onSubmit={handleValidateImport}>
              <label className="field">
                <span>Режим</span>
                <select value={importMode} onChange={(event) => setImportMode(event.target.value as "append" | "replace")}>
                  <option value="append">append - добавить</option>
                  <option value="replace">replace - заменить активные вопросы</option>
                </select>
              </label>
              <label className="field wide">
                <span>Файл .xlsx или .csv</span>
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                  required
                />
              </label>
              <button className="button" type="submit" disabled={importBusy}>
                Проверить файл
              </button>
            </form>

            {importJob ? (
              <div className="stack">
                <p className="muted">
                  Status: {importJob.status}. Rows: {importJob.totalRows}. Valid: {importJob.validRows}. Errors:{" "}
                  {importJob.errorRows}. Warnings: {importJob.warningRows}.
                </p>
                {importJob.errors.length > 0 ? (
                  <div className="issue-box error">
                    <strong>Критические ошибки</strong>
                    <ul>
                      {importJob.errors.slice(0, 20).map((item, index) => (
                        <li key={`${item.code}-${index}`}>
                          Row {item.rowNumber ?? "file"}, {item.field ?? "file"}: {item.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {importJob.warnings.length > 0 ? (
                  <div className="issue-box warning">
                    <strong>Warnings</strong>
                    <ul>
                      {importJob.warnings.slice(0, 20).map((item, index) => (
                        <li key={`${item.code}-${index}`}>
                          Row {item.rowNumber ?? "file"}, {item.field ?? "file"}: {item.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {importJob.preview.length > 0 ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Вопрос</th>
                          <th>Тип</th>
                          <th>Ответ</th>
                          <th>Тема</th>
                          <th>Балл</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importJob.preview.slice(0, 10).map((question, index) => (
                          <tr key={`${question.questionText}-${index}`}>
                            <td>{index + 1}</td>
                            <td>{question.questionText}</td>
                            <td>{question.questionType}</td>
                            <td>{question.correctAnswer}</td>
                            <td>{question.topic}</td>
                            <td>{question.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <button
                  className="button"
                  type="button"
                  disabled={importBusy || importJob.errors.length > 0 || importJob.status === "imported"}
                  onClick={handleCommitImport}
                >
                  Commit import
                </button>
              </div>
            ) : null}
          </section>

          <section className="subpanel stack">
            <div>
              <h3 className="subsection-title">Доступы и оплата</h3>
              <p className="muted">
                Ручная выдача, одноразовые коды и последние mock-оплаты по выбранному тесту.
              </p>
            </div>

            <form className="form-grid" onSubmit={handleCreateManualAccess}>
              <label className="field wide">
                <span>Email ученика</span>
                <input
                  value={manualAccessForm.email}
                  onChange={(event) =>
                    setManualAccessForm({ ...manualAccessForm, email: event.target.value })
                  }
                  type="email"
                  required
                />
              </label>
              <label className="field">
                <span>Попытки</span>
                <input
                  value={manualAccessForm.attemptsTotal}
                  onChange={(event) =>
                    setManualAccessForm({ ...manualAccessForm, attemptsTotal: event.target.value })
                  }
                  type="number"
                  min="1"
                  required
                />
              </label>
              <label className="field">
                <span>Дней доступа</span>
                <input
                  value={manualAccessForm.accessDays}
                  onChange={(event) =>
                    setManualAccessForm({ ...manualAccessForm, accessDays: event.target.value })
                  }
                  type="number"
                  min="1"
                  required
                />
              </label>
              <label className="field wide">
                <span>Комментарий</span>
                <input
                  value={manualAccessForm.comment}
                  onChange={(event) =>
                    setManualAccessForm({ ...manualAccessForm, comment: event.target.value })
                  }
                />
              </label>
              <button className="button" type="submit">
                Выдать доступ
              </button>
            </form>

            <form className="form-grid" onSubmit={handleCreateAccessCode}>
              <label className="field">
                <span>Попытки по коду</span>
                <input
                  value={accessCodeForm.attemptsTotal}
                  onChange={(event) =>
                    setAccessCodeForm({ ...accessCodeForm, attemptsTotal: event.target.value })
                  }
                  type="number"
                  min="1"
                  required
                />
              </label>
              <label className="field">
                <span>Дней доступа</span>
                <input
                  value={accessCodeForm.accessDays}
                  onChange={(event) =>
                    setAccessCodeForm({ ...accessCodeForm, accessDays: event.target.value })
                  }
                  type="number"
                  min="1"
                  required
                />
              </label>
              <label className="field">
                <span>Код действует дней</span>
                <input
                  value={accessCodeForm.codeExpiresDays}
                  onChange={(event) =>
                    setAccessCodeForm({ ...accessCodeForm, codeExpiresDays: event.target.value })
                  }
                  type="number"
                  min="1"
                  required
                />
              </label>
              <label className="field wide">
                <span>Комментарий</span>
                <input
                  value={accessCodeForm.comment}
                  onChange={(event) =>
                    setAccessCodeForm({ ...accessCodeForm, comment: event.target.value })
                  }
                />
              </label>
              <button className="button secondary" type="submit">
                Создать код
              </button>
            </form>

            {createdCode ? (
              <div className="state-box success">
                <p>Новый код: {createdCode}</p>
                <p className="muted">Код хранится только как hash и больше не будет показан.</p>
              </div>
            ) : null}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Источник</th>
                    <th>Попытки</th>
                    <th>Действует до</th>
                    <th>Статус</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {accesses.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Доступов пока нет.</td>
                    </tr>
                  ) : (
                    accesses.map((access) => (
                      <tr key={access.id}>
                        <td>{access.email}</td>
                        <td>{access.source}</td>
                        <td>
                          {access.attemptsAvailable} из {access.attemptsTotal}
                        </td>
                        <td>{new Date(access.expiresAt).toLocaleDateString()}</td>
                        <td><span className={statusClass(access.revokedAt ? "revoked" : "active")}>{access.revokedAt ? "revoked" : "active"}</span></td>
                        <td>
                          <button
                            className="button danger small"
                            type="button"
                            disabled={Boolean(access.revokedAt)}
                            onClick={() => handleRevokeAccess(access.id)}
                          >
                            Отозвать
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Код</th>
                    <th>Статус</th>
                    <th>Попытки</th>
                    <th>Активирован</th>
                    <th>Истекает</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {accessCodes.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Кодов пока нет.</td>
                    </tr>
                  ) : (
                    accessCodes.map((codeItem) => (
                      <tr key={codeItem.id}>
                        <td>hash only</td>
                        <td><span className={statusClass(codeItem.status)}>{codeItem.status}</span></td>
                        <td>{codeItem.attemptsTotal}</td>
                        <td>{codeItem.activatedByEmail ?? "-"}</td>
                        <td>{new Date(codeItem.codeExpiresAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            className="button danger small"
                            type="button"
                            disabled={codeItem.status !== "active"}
                            onClick={() => handleRevokeAccessCode(codeItem.id)}
                          >
                            Отозвать
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Провайдер</th>
                    <th>Статус</th>
                    <th>Сумма</th>
                    <th>Provider ID</th>
                    <th>Account</th>
                    <th>Access</th>
                    <th>NPD</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan={8}>Оплат пока нет.</td>
                    </tr>
                  ) : (
                    payments.map((paymentItem) => (
                      <tr key={paymentItem.id}>
                        <td>{paymentItem.email}</td>
                        <td>{paymentItem.provider}</td>
                        <td>
                          <span className={statusClass(paymentItem.status)}>{paymentItem.status}</span>
                          {paymentItem.providerStatus ? <p className="muted">{paymentItem.providerStatus}</p> : null}
                        </td>
                        <td>{formatMoney(paymentItem.amount, paymentItem.currency)}</td>
                        <td>{paymentItem.providerInvoiceId ?? paymentItem.providerPaymentId ?? "-"}</td>
                        <td>{paymentItem.providerAccountNumber ?? "-"}</td>
                        <td>{paymentItem.accessCreated ? "created" : "-"}</td>
                        <td>
                          {!paymentItem.npdReceiptRequired ? (
                            "-"
                          ) : paymentItem.npdReceiptCreated ? (
                            "created"
                          ) : (
                            <button
                              className="button secondary small"
                              type="button"
                              onClick={() => handleMarkNpdReceiptCreated(paymentItem.id)}
                            >
                              Mark created
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Статус</th>
                    <th>Балл</th>
                    <th>Процент</th>
                    <th>Уровень</th>
                    <th>Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Попыток пока нет.</td>
                    </tr>
                  ) : (
                    attempts.map((attemptItem) => (
                      <tr key={attemptItem.id}>
                        <td>{attemptItem.email}</td>
                        <td><span className={statusClass(attemptItem.status)}>{attemptItem.status}</span></td>
                        <td>
                          {attemptItem.rawScore === null || attemptItem.maxRawScore === null
                            ? "-"
                            : `${attemptItem.rawScore} / ${attemptItem.maxRawScore}`}
                        </td>
                        <td>{attemptItem.percent === null ? "-" : `${attemptItem.percent.toFixed(1)}%`}</td>
                        <td>{attemptItem.level ?? "-"}</td>
                        <td>
                          <a className="text-link" href={`/api/admin/attempts/${attemptItem.id}`} target="_blank">
                            JSON
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <form className="form-grid" onSubmit={handleCreateQuestion}>
            <label className="field wide">
              <span>Текст вопроса</span>
              <textarea
                value={questionForm.questionText}
                onChange={(event) =>
                  setQuestionForm({ ...questionForm, questionText: event.target.value })
                }
                rows={3}
                required
              />
            </label>
            <label className="field">
              <span>Тип</span>
              <select
                value={questionForm.questionType}
                onChange={(event) =>
                  setQuestionForm({ ...questionForm, questionType: event.target.value })
                }
              >
                <option value="single_choice">Один ответ</option>
                <option value="multiple_choice">Несколько ответов</option>
                <option value="short_text">Короткий текст</option>
              </select>
            </label>
            <label className="field">
              <span>Правильный ответ</span>
              <input
                value={questionForm.correctAnswer}
                onChange={(event) =>
                  setQuestionForm({ ...questionForm, correctAnswer: event.target.value })
                }
                placeholder="A или A,C или пришёл;пришел"
                required
              />
            </label>
            <label className="field">
              <span>Баллы</span>
              <input
                value={questionForm.points}
                onChange={(event) => setQuestionForm({ ...questionForm, points: event.target.value })}
                type="number"
                min="1"
                required
              />
            </label>
            {questionForm.questionType !== "short_text" ? (
              <>
                {(["A", "B", "C", "D"] as const).map((letter) => {
                  const key = `option${letter}` as "optionA" | "optionB" | "optionC" | "optionD";
                  return (
                    <label className="field" key={letter}>
                      <span>Вариант {letter}</span>
                      <input
                        value={questionForm[key]}
                        onChange={(event) => setQuestionForm({ ...questionForm, [key]: event.target.value })}
                      />
                    </label>
                  );
                })}
              </>
            ) : null}
            <label className="field">
              <span>Тема</span>
              <input
                value={questionForm.topic}
                onChange={(event) => setQuestionForm({ ...questionForm, topic: event.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Подтема</span>
              <input
                value={questionForm.subtopic}
                onChange={(event) => setQuestionForm({ ...questionForm, subtopic: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Сложность</span>
              <select
                value={questionForm.difficulty}
                onChange={(event) =>
                  setQuestionForm({ ...questionForm, difficulty: event.target.value })
                }
              >
                <option value="easy">Легко</option>
                <option value="medium">Средне</option>
                <option value="hard">Сложно</option>
              </select>
            </label>
            <label className="field wide">
              <span>Объяснение</span>
              <textarea
                value={questionForm.explanation}
                onChange={(event) =>
                  setQuestionForm({ ...questionForm, explanation: event.target.value })
                }
                rows={3}
              />
            </label>
            <button className="button" type="submit">
              Добавить вопрос
            </button>
          </form>

          {questions.length === 0 ? (
            <p className="muted">В этом тесте пока нет вопросов.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Вопрос</th>
                    <th>Тип</th>
                    <th>Ответ</th>
                    <th>Тема</th>
                    <th>Баллы</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((question) => (
                    <tr key={question.id}>
                      <td>{question.orderIndex}</td>
                      <td>
                        <div className="table-title">{question.questionText}</div>
                        {question.subtopic ? <div className="muted">{question.subtopic}</div> : null}
                      </td>
                      <td>{question.questionType}</td>
                      <td>{question.correctAnswer}</td>
                      <td>{question.topic}</td>
                      <td>{question.points}</td>
                      <td>
                        <div className="inline-actions">
                          <button
                            className="button secondary small"
                            type="button"
                            onClick={() => handleQuestionOrder(question.id, "up")}
                          >
                            Вверх
                          </button>
                          <button
                            className="button secondary small"
                            type="button"
                            onClick={() => handleQuestionOrder(question.id, "down")}
                          >
                            Вниз
                          </button>
                          <button
                            className="button danger small"
                            type="button"
                            onClick={() => handleDeleteQuestion(question.id)}
                          >
                            Удалить
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
