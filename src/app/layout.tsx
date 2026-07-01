import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ЦЭ/ЦТ Online Tests MVP",
  description: "MVP сервиса онлайн-тестов по русскому языку"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
