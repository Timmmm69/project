import type { Metadata } from "next";
import { LegalPageShell, LegalSection, legalStyles } from "@/components/public/legal-page-shell";
import { SELLER } from "@/content/legal";

export const metadata: Metadata = { title: "Поддержка | Практика русского" };

export default function SupportPage() {
  return (
    <LegalPageShell title="Поддержка" description="Куда обратиться по вопросам заказа, оплаты, доступа, результата или возврата.">
      <LegalSection title="Контакты">
        <dl className={legalStyles.details}>
          <div><dt>Email</dt><dd><a className={legalStyles.link} href={`mailto:${SELLER.email}`}>{SELLER.email}</a></dd></div>
          <div><dt>Телефон</dt><dd><a className={legalStyles.link} href={SELLER.phoneHref}>{SELLER.phoneDisplay}</a></dd></div>
          <div><dt>Режим работы</dt><dd>{SELLER.supportHours}</dd></div>
          <div><dt>Обычный срок ответа</dt><dd>{SELLER.supportResponseTime}</dd></div>
        </dl>
      </LegalSection>
      <LegalSection title="Что указать">
        <ul>
          <li>Email, с которым оформлялся заказ.</li>
          <li>Публичный номер заказа со страницы статуса.</li>
          <li>Краткое описание проблемы и время её возникновения.</li>
        </ul>
        <p className={legalStyles.notice}>Не отправляйте номер карты полностью, CVV/CVC, банковский пароль, коды из SMS или снимок банковской карты.</p>
      </LegalSection>
      <LegalSection title="Если статус платежа неизвестен">
        <p>Не создавайте повторную оплату. Дождитесь завершения автоматической проверки, затем обновите статус вручную. Если сайт предложил обратиться в поддержку, сообщите публичный номер заказа.</p>
      </LegalSection>
      <LegalSection title="Если оплата есть, а доступа нет">
        <p>Повторно платить не нужно. Поддержка проверит подтверждённый статус и выдачу доступа. Автоматический возврат без проверки не выполняется.</p>
      </LegalSection>
    </LegalPageShell>
  );
}
