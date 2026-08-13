import Link from "next/link";
import { PUBLIC_LEGAL_LINKS, SELLER } from "@/content/legal";
import styles from "./site-footer.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.seller}>
          <strong>Практика русского</strong>
          <p>{SELLER.displayName}</p>
          <p>{SELLER.status}</p>
          <p>УНП {SELLER.unp}, {SELLER.country}</p>
          <a href={`mailto:${SELLER.email}`}>{SELLER.email}</a>
          <a href={SELLER.phoneHref}>{SELLER.phoneDisplay}</a>
        </div>
        <nav aria-label="Правовая информация" className={styles.links}>
          <Link href={PUBLIC_LEGAL_LINKS.seller}>Продавец и контакты</Link>
          <Link href={PUBLIC_LEGAL_LINKS.offer}>Публичная оферта</Link>
          <Link href={PUBLIC_LEGAL_LINKS.payment}>Оплата и безопасность</Link>
          <Link href={PUBLIC_LEGAL_LINKS.refunds}>Возврат средств</Link>
          <Link href={PUBLIC_LEGAL_LINKS.delivery}>Получение услуги и чек</Link>
          <Link href={PUBLIC_LEGAL_LINKS.privacy}>Обработка персональных данных</Link>
          <Link href={PUBLIC_LEGAL_LINKS.support}>Поддержка</Link>
        </nav>
      </div>
    </footer>
  );
}
