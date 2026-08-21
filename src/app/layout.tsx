import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["cyrillic", "latin"],
  display: "swap",
  variable: "--font-manrope"
});

export const metadata: Metadata = {
  title: "Практика ЦЭ/ЦТ по русскому языку",
  description: "Онлайн-тесты по русскому языку с таймером, автосохранением и понятным результатом."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html className={manrope.variable} lang="ru">
      <body>{children}</body>
    </html>
  );
}
