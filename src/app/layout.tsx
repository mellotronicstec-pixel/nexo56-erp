import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
import './globals.css';

/**
 * Tipografia oficial (Prompt 00, itens 75/76/83; Prompt 01, item 51).
 *
 * `next/font/google` baixa as fontes NO BUILD e as serve do proprio dominio:
 * sem requisicao a terceiros em runtime, sem CLS e sem depender de CDN externa
 * em producao. Apenas os pesos previstos na Constituicao sao carregados —
 * Sora 600/700 e Inter 400/500/600 — com `font-display: swap` (padrao do
 * next/font). Ambas as familias sao SIL Open Font License.
 */
const sora = Sora({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-sora',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Nexo56 ERP',
    template: '%s · Nexo56 ERP',
  },
  description: 'Nexo56 ERP — gestao de assistencia tecnica e reparo.',
  applicationName: 'Nexo56 ERP',
  robots: { index: false, follow: false },
};

/** Preparacao para PWA (Prompt 01, item 60): viewport e tema ja definidos. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0066ff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sora.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
