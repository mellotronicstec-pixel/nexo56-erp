'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar, Button } from '@/design-system/components';
import { BrandMark } from '@/design-system/components/brand-mark';
import { cn } from '@/design-system/cn';
import type { NavSection } from './navigation';
import { logoutAction, switchUnitAction } from './actions';

/**
 * Shell autenticado (Prompt 01, item 56).
 *
 * Desktop: sidebar fixa + topbar + area de conteudo.
 * Mobile: a sidebar NAO e comprimida — vira uma gaveta acionada pela topbar,
 * com alvos de toque de 44px e fechamento por Esc e por toque no overlay.
 */

export interface ShellUser {
  name: string;
  email: string;
  tenantName: string;
  unitName: string | null;
}

export interface ShellUnit {
  id: string;
  name: string;
}

/**
 * Seletor de unidade ativa (Prompt 03, item 23).
 *
 * A lista contem APENAS unidades autorizadas — e mesmo assim o servidor
 * revalida a escolha antes de gravar o cookie, e o contexto revalida a cada
 * requisicao. O cliente pede; quem decide e o backend.
 *
 * Com uma unica unidade, nao aparece seletor algum (item 24).
 */
function UnitSwitcher({
  units,
  activeUnitId,
}: {
  units: ShellUnit[];
  activeUnitId: string | null;
}) {
  if (units.length <= 1) return null;

  return (
    <form action={switchUnitAction} className="flex items-center gap-2">
      <label htmlFor="unit-switcher" className="sr-only">
        Unidade ativa
      </label>
      <select
        id="unit-switcher"
        name="unitId"
        defaultValue={activeUnitId ?? ''}
        className="h-9 max-w-[200px] rounded-md border border-ink-300 bg-white px-2 text-ui text-ink-800 shadow-xs"
      >
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name}
          </option>
        ))}
      </select>
      <Button type="submit" variant="secondary" size="sm">
        Trocar
      </Button>
    </form>
  );
}

export function Shell({
  sections,
  user,
  units,
  activeUnitId,
  children,
}: {
  sections: NavSection[];
  user: ShellUser;
  units: ShellUnit[];
  activeUnitId: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const nav = (
    <nav aria-label="Navegacao principal" className="flex flex-col gap-6 px-3 py-4">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-2 text-small font-semibold tracking-wide text-ink-400 uppercase">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center rounded-md px-3 py-2 text-ui font-medium transition-colors',
                      'touch-target md:min-h-0',
                      active
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-ink-50">
      {/* Sidebar — desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-ink-200 bg-white md:block">
        <div className="flex h-14 items-center border-b border-ink-200 px-5">
          <BrandMark />
        </div>
        {nav}
      </aside>

      {/* Gaveta — mobile */}
      {drawerOpen ? (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-200 bg-ink-900/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="fixed inset-y-0 left-0 z-300 w-72 max-w-[85vw] overflow-y-auto border-r border-ink-200 bg-white"
          >
            <div className="flex h-14 items-center justify-between border-b border-ink-200 px-4">
              <BrandMark />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrawerOpen(false)}
                aria-label="Fechar menu"
              >
                Fechar
              </Button>
            </div>
            {units.length > 1 ? (
              <div className="border-b border-ink-200 px-4 py-3">
                <p className="mb-2 text-small font-semibold tracking-wide text-ink-400 uppercase">
                  Unidade ativa
                </p>
                <UnitSwitcher units={units} activeUnitId={activeUnitId} />
              </div>
            ) : null}
            {nav}
          </div>
        </div>
      ) : null}

      <div className="md:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-100 flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-4 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            className="touch-target md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={drawerOpen}
          >
            Menu
          </Button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-ui font-semibold text-ink-900">{user.tenantName}</p>
            {user.unitName ? (
              <p className="truncate text-small text-ink-500">{user.unitName}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden lg:block">
              <UnitSwitcher units={units} activeUnitId={activeUnitId} />
            </div>
            <div className="hidden text-right sm:block">
              <p className="text-ui font-medium text-ink-800">{user.name}</p>
              <p className="text-small text-ink-500">{user.email}</p>
            </div>
            <Avatar name={user.name} />
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" size="sm">
                Sair
              </Button>
            </form>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
