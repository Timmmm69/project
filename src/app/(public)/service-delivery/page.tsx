import type { Metadata } from "next";
import { LegalPageShell, LegalSection, legalStyles } from "@/components/public/legal-page-shell";
import { SELLER, SERVICE_TERMS } from "@/content/legal";

export const metadata: Metadata = { title: "Получение услуги и чек | Практика русского" };

export default function ServiceDeliveryPage() {
  return (
    <LegalPageShell title="Получение услуги и чек" description="Как покупатель получает цифровую услугу, контролирует заказ и получает документы об оплате.">
      <LegalSection title="Что получает покупатель">
        <p>{SERVICE_TERMS.name}. Физическая доставка не требуется, стоимость доставки отсутствует.</p>
        <ul>
          <li>Одна попытка.</li>
          <li>До {SERVICE_TERMS.startWindowDays} дней для начала после подтверждения оплаты.</li>
          <li>{SERVICE_TERMS.durationMinutes} минут после запуска.</li>
          <li>Первичный результат после завершения.</li>
          <li>Доступ к результату в течение {SERVICE_TERMS.resultRetentionMonths} месяцев.</li>
        </ul>
      </LegalSection>
      <LegalSection title="Порядок получения">
        <ol>
          <li>Покупатель подтверждает email и оплачивает заказ через WEBPAY.</li>
          <li>Сайт проверяет платёж у провайдера. Возврат на сайт сам по себе не подтверждает оплату.</li>
          <li>После подтверждения создаётся доступ к одной попытке.</li>
          <li>Покупатель запускает тест сразу или возвращается позднее через восстановление по подтверждённому email.</li>
        </ol>
      </LegalSection>
      <LegalSection title="Контроль заказа">
        <p>На странице заказа отображаются безопасный публичный номер, статус, время обновления и доступные действия. Ручное обновление статуса не создаёт новый заказ или новую оплату.</p>
        <p>Если доступ не появился после подтверждённой оплаты, повторно платить не нужно. Обратитесь в поддержку и сообщите публичный номер заказа.</p>
      </LegalSection>
      <LegalSection title="Документы об оплате">
        <p>WEBPAY отправляет электронное подтверждение успешного платежа. Дополнительно исполнитель формирует чек через приложение «Налог на профессиональный доход» по каждому факту расчёта и передаёт его покупателю.</p>
        <p>Для плательщика НПД отдельное кассовое оборудование не требуется, но обязанность сформировать чек НПД сохраняется.</p>
      </LegalSection>
      <LegalSection title="Помощь">
        <p>Если письмо или доступ не пришли, напишите на <a className={legalStyles.link} href={`mailto:${SELLER.email}`}>{SELLER.email}</a> или позвоните по номеру <a className={legalStyles.link} href={SELLER.phoneHref}>{SELLER.phoneDisplay}</a>.</p>
      </LegalSection>
    </LegalPageShell>
  );
}
