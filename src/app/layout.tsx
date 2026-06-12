import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Coleta de Informações",
  description: "Registre conversas por voz ou texto. A IA identifica cliente e operador.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
