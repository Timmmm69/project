import type { Metadata } from "next";
import { LegalPageShell, LegalSection, legalStyles } from "@/components/public/legal-page-shell";
import { PUBLIC_LEGAL_LINKS, SELLER, SERVICE_TERMS } from "@/content/legal";

export const metadata: Metadata = { title: "Публичная оферта | Практика русского" };

export default function OfferPage() {
  return (
    <LegalPageShell title="Публичная оферта" description="Условия приобретения разового доступа к тренировочному онлайн-тесту по русскому языку.">
      <LegalSection title="1. Стороны и принятие условий">
        <p>Исполнитель: {SELLER.displayName}, {SELLER.status}, УНП {SELLER.unp}.</p>
        <p>Заказчик принимает настоящую оферту, когда подтверждает совершеннолетие, ознакомление с условиями и нажимает кнопку перехода к оплате. Оплата означает заключение договора на указанных условиях.</p>
      </LegalSection>
      <LegalSection title="2. Предмет договора">
        <p>Исполнитель предоставляет заказчику цифровую услугу: {SERVICE_TERMS.name.toLowerCase()}.</p>
        <ul>
          <li>Стоимость: {SERVICE_TERMS.price}.</li>
          <li>Одна покупка предоставляет {SERVICE_TERMS.attempts} попытку.</li>
          <li>Начать тест можно в течение {SERVICE_TERMS.startWindowDays} дней после подтверждения оплаты.</li>
          <li>После начала на выполнение отводится {SERVICE_TERMS.durationMinutes} минут без паузы.</li>
          <li>Результат доступен в течение {SERVICE_TERMS.resultRetentionMonths} месяцев.</li>
        </ul>
      </LegalSection>
      <LegalSection title="3. Оформление и оплата">
        <ol>
          <li>Заказчик выбирает опубликованный тест и подтверждает свой email одноразовым кодом.</li>
          <li>До оплаты заказчик видит цену, состав услуги, ограничения и актуальные документы.</li>
          <li>Оплата выполняется банковской картой на защищённой странице WEBPAY.</li>
          <li>Доступ создаётся только после подтверждения платежа платёжным сервисом.</li>
        </ol>
        <p>Подробные правила приведены на странице <a className={legalStyles.link} href={PUBLIC_LEGAL_LINKS.payment}>«Оплата и безопасность»</a>.</p>
      </LegalSection>
      <LegalSection title="4. Оказание услуги">
        <p>Услуга считается начатой после запуска попытки. Ответы автоматически сохраняются. После завершения показывается первичный результат в объёме, указанном на странице теста.</p>
        <p>Порядок восстановления доступа и контроля заказа описан на странице <a className={legalStyles.link} href={PUBLIC_LEGAL_LINKS.delivery}>«Получение услуги и чек»</a>.</p>
      </LegalSection>
      <LegalSection title="5. Возвраты и обращения">
        <p>Возвраты не выполняются автоматически. Каждое обращение рассматривается с учётом фактически оказанной части услуги и обязательных требований законодательства.</p>
        <p>Условия и сроки приведены на странице <a className={legalStyles.link} href={PUBLIC_LEGAL_LINKS.refunds}>«Возврат средств»</a>. Обращения принимаются по адресу <a className={legalStyles.link} href={`mailto:${SELLER.email}`}>{SELLER.email}</a>.</p>
      </LegalSection>
      <LegalSection title="6. Персональные данные">
        <p>Для исполнения договора используются email, сведения о заказе, статус платежа и технические данные безопасности. Реквизиты банковской карты сайт не получает.</p>
        <p>Подробности опубликованы в <a className={legalStyles.link} href={PUBLIC_LEGAL_LINKS.privacy}>политике обработки персональных данных</a>.</p>
      </LegalSection>
      <LegalSection title="7. Ответственность и споры">
        <p>Стороны стремятся урегулировать спор путём обращения в поддержку. Ограничения настоящей оферты не отменяют обязательные права потребителя, предусмотренные законодательством Республики Беларусь.</p>
      </LegalSection>
    </LegalPageShell>
  );
}
