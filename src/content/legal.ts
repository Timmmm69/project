export const SELLER = {
  displayName: "Колюгова Софья Игоревна",
  status: "физическое лицо, применяющее налог на профессиональный доход",
  unp: "EE8047957",
  country: "Республика Беларусь",
  phoneDisplay: "+375 29 376-89-88",
  phoneHref: "tel:+375293768988",
  email: "kolyugova42@icloud.com",
  supportHours: "Понедельник-пятница, 10:00-18:00 по минскому времени",
  supportResponseTime: "Ответ в течение двух рабочих дней"
} as const;

export const LEGAL_DOCUMENT_VERSION = "2026-08-13";

export const SERVICE_TERMS = {
  name: "Одна попытка тренировочного онлайн-теста по русскому языку",
  price: "10,00 BYN",
  attempts: 1,
  startWindowDays: 90,
  durationMinutes: 120,
  resultRetentionMonths: 12
} as const;

export const PUBLIC_LEGAL_LINKS = {
  seller: "/seller",
  offer: "/offer",
  payment: "/payment",
  refunds: "/refunds",
  privacy: "/privacy",
  delivery: "/service-delivery",
  support: "/support"
} as const;
