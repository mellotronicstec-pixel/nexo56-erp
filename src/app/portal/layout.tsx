import type { Metadata } from 'next';

/**
 * LAYOUT DO PORTAL — deliberadamente vazio de shell (Prompt 17, item 31).
 *
 * Nao importa nada de `(app)`: sem menu lateral, sem cabecalho de unidade,
 * sem nenhum componente que espere um `TenantContext`. Cada pagina do Portal
 * monta a propria moldura — a de login e a autenticada sao visualmente
 * diferentes de proposito (a segunda tem "Sair"; a primeira nao tem o que
 * sair de).
 */
export const metadata: Metadata = {
  title: { default: 'Portal do Cliente', template: '%s · Portal do Cliente' },
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-ink-50">{children}</div>;
}
