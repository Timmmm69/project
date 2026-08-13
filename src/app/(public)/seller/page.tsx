import type { Metadata } from "next";
import { LegalPageShell, LegalSection, legalStyles } from "@/components/public/legal-page-shell";
import { SELLER } from "@/content/legal";

export const metadata: Metadata = { title: "Продавец и контакты | Практика русского" };

export default function SellerPage() {
  return (
    <LegalPageShell title="Продавец и контакты" description="Сведения об исполнителе цифровой образовательной услуги и способы связи.">
      <LegalSection title="Исполнитель">
        <dl className={legalStyles.details}>
          <div><dt>Фамилия, имя, отчество</dt><dd>{SELLER.displayName}</dd></div>
          <div><dt>Статус</dt><dd>{SELLER.status}</dd></div>
          <div><dt>УНП</dt><dd>{SELLER.unp}</dd></div>
          <div><dt>Страна</dt><dd>{SELLER.country}</dd></div>
        </dl>
      </LegalSection>
      <LegalSection title="Связь и поддержка">
        <dl className={legalStyles.details}>
          <div><dt>Email</dt><dd><a className={legalStyles.link} href={`mailto:${SELLER.email}`}>{SELLER.email}</a></dd></div>
          <div><dt>Телефон</dt><dd><a className={legalStyles.link} href={SELLER.phoneHref}>{SELLER.phoneDisplay}</a></dd></div>
          <div><dt>Режим работы</dt><dd>{SELLER.supportHours}</dd></div>
          <div><dt>Срок ответа</dt><dd>{SELLER.supportResponseTime}</dd></div>
        </dl>
      </LegalSection>
    </LegalPageShell>
  );
}
