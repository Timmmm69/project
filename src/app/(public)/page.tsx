export default function PublicCatalogPage() {
  return (
    <main className="page-shell">
      <section className="panel">
        <p style={{ color: "var(--muted)", margin: "0 0 8px" }}>Публичная часть</p>
        <h1 style={{ fontSize: 32, lineHeight: 1.15, margin: "0 0 16px" }}>
          Каталог тестов
        </h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>Пока нет опубликованных тестов.</p>
      </section>
    </main>
  );
}
