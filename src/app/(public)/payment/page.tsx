import Image from "next/image";
import type { Metadata } from "next";
import { LegalPageShell, LegalSection, legalStyles } from "@/components/public/legal-page-shell";
import { SELLER, SERVICE_TERMS } from "@/content/legal";

export const metadata: Metadata = { title: "Оплата и безопасность | Практика русского" };

export default function PaymentPage() {
  return (
    <LegalPageShell title="Оплата и безопасность" description="Единственный способ оплаты при первом запуске: банковская карта через защищённую платёжную страницу WEBPAY.">
      <LegalSection title="Стоимость и способ оплаты">
        <p>Стоимость одной попытки составляет {SERVICE_TERMS.price}. Все цены и расчёты указаны в белорусских рублях.</p>
        <p>После проверки заказа сайт перенаправляет покупателя в той же вкладке на защищённую страницу WEBPAY. Доступные платёжные системы определяются условиями подключённого эквайринга.</p>
        <Image alt="WEBPAY, Visa, Mastercard и БЕЛКАРТ" height={31} src="/payment-logos/mtbank-card-payment-logos.svg" width={420} />
      </LegalSection>
      <LegalSection title="Как оплатить">
        <ol>
          <li>Выберите тест и подтвердите email.</li>
          <li>Проверьте стоимость, одну попытку, срок начала и длительность.</li>
          <li>Примите условия оферты и нажмите «Перейти к оплате картой».</li>
          <li>Введите реквизиты карты только на странице WEBPAY и завершите банковское подтверждение.</li>
          <li>Вернитесь на сайт и дождитесь подтверждённого статуса. Сам возврат браузера не означает успешную оплату.</li>
        </ol>
      </LegalSection>
      <LegalSection title="Безопасность платежа">
        <p className={legalStyles.notice}>Этот сайт не запрашивает и не хранит номер карты, срок действия, CVV/CVC, банковский пароль или код 3-D Secure.</p>
        <p>Платёж считается успешным только после проверки статуса через платёжного провайдера. При неизвестном или ожидающем статусе не оплачивайте заказ повторно.</p>
      </LegalSection>
      <LegalSection title="Подтверждение оплаты">
        <p>После успешной операции WEBPAY направляет электронное подтверждение платежа. Исполнитель также формирует чек в приложении «Налог на профессиональный доход» и передаёт его покупателю по правилам НПД.</p>
      </LegalSection>
      <LegalSection title="Проблемы с оплатой">
        <p>Если статус не изменился, используйте кнопку обновления на странице заказа. Если ожидание превышает указанный там срок, напишите на <a className={legalStyles.link} href={`mailto:${SELLER.email}`}>{SELLER.email}</a> и сообщите только публичный номер заказа.</p>
        <p>Поддержка никогда не просит реквизиты карты, банковский пароль или одноразовый банковский код.</p>
      </LegalSection>
    </LegalPageShell>
  );
}
