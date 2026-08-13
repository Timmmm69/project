import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_DOCUMENT_VERSION } from "@/content/legal";
import styles from "./legal-page-shell.module.css";

export function LegalPageShell({ title, description, children }: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">Практика русского</Link>
        <Link className={styles.link} href="/">К тестам</Link>
      </header>
      <article className={styles.article}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>Версия от {LEGAL_DOCUMENT_VERSION}</p>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.lead}>{description}</p>
        </header>
        <div className={styles.body}>{children}</div>
      </article>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      <div className={styles.content}>{children}</div>
    </section>
  );
}

export const legalStyles = styles;
