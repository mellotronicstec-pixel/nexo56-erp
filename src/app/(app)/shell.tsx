'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ComponentType } from 'react';
import {
  Avatar,
  Button,
  Drawer,
  IconButton,
  Menu,
  MenuHeader,
  MenuItem,
  MenuSeparator,
  MENU_ROW,
} from '@/design-system/components';
import { BrandMark } from '@/design-system/components/brand-mark';
import {
  IconBuilding,
  IconChevronDown,
  IconCustomers,
  IconEquipment,
  IconIntake,
  IconHistory,
  IconKey,
  IconLogout,
  IconMenu,
  IconModules,
  IconShield,
  IconUser,
  IconUsers,
  type IconProps,
  IconCashRegister,
  IconWarranty,
  IconAgenda,
  IconWorkCenter,
  IconTask,
  IconFinance,
  IconInventory,
  IconMessage,
  IconPurchase,
  IconServiceOrder,
  IconSupplier,
} from '@/design-system/icons';
import { cn } from '@/design-system/cn';
import type { NavIconKey, NavSection } from './navigation';
import { logoutAction, switchUnitAction } from './actions';

/**
 * Chave de icone -> desenho (Prompt 04, item 62).
 *
 * O layout e Server Component e nao pode enviar funcoes pela fronteira, entao
 * manda a chave; a resolucao acontece aqui, no cliente.
 */
const NAV_ICONS: Record<NavIconKey, ComponentType<IconProps>> = {
  user: IconUser,
  users: IconUsers,
  shield: IconShield,
  building: IconBuilding,
  modules: IconModules,
  history: IconHistory,
  customers: IconCustomers,
  equipment: IconEquipment,
  intake: IconIntake,
  'service-order': IconServiceOrder,
  inventory: IconInventory,
  supplier: IconSupplier,
  purchase: IconPurchase,
  finance: IconFinance,
  'cash-register': IconCashRegister,
  warranty: IconWarranty,
  agenda: IconAgenda,
  'work-center': IconWorkCenter,
  task: IconTask,
  message: IconMessage,
};

/**
 * Shell autenticado (Prompt 01, item 56; Prompt 04, itens 33 a 38).
 *
 * Desktop (>= md): sidebar fixa + topbar + area de conteudo.
 * Tablet: a mesma estrutura, com a sidebar ainda fixa a partir de 768px.
 * Mobile: a sidebar NAO e comprimida — vira uma gaveta acionada pela topbar,
 * com alvos de toque de 44px, foco preso e devolvido, fechamento por Esc e por
 * toque fora.
 *
 * O shell e Client Component porque precisa de rota atual, gaveta e menu. Ele
 * NAO carrega dados e NAO decide acesso: recebe pronto do layout, que e
 * Server Component (Prompt 04, itens 75 e 76).
 */

export interface ShellUser {
  name: string;
  email: string;
  tenantName: string;
  unitName: string | null;
  /** Papeis resumidos para exibicao no menu — texto ja pronto do servidor. */
  roleSummary: string | null;
}

export interface ShellUnit {
  id: string;
  name: string;
}

/**
 * Seletor de unidade ativa (Prompt 03, item 23 — comportamento PRESERVADO).
 *
 * A lista contem APENAS unidades autorizadas — e mesmo assim o servidor
 * revalida a escolha antes de gravar o cookie, e o contexto revalida a cada
 * requisicao. O cliente pede; quem decide e o backend.
 *
 * Com uma unica unidade, nao aparece seletor algum (item 24): nao existe
 * interacao para uma escolha que nao existe.
 */
function UnitSwitcher({
  units,
  activeUnitId,
  className,
}: {
  units: ShellUnit[];
  activeUnitId: string | null;
  className?: string;
}) {
  if (units.length <= 1) return null;

  return (
    <form action={switchUnitAction} className={cn('flex items-center gap-2', className)}>
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

/** Menu da pessoa autenticada (Prompt 04, item 38). Somente o que existe. */
function UserMenu({ user }: { user: ShellUser }) {
  return (
    <Menu
      label="Menu da conta"
      trigger={({ open }) => (
        <span className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-ink-100">
          <Avatar name={user.name} />
          <span className="hidden text-left sm:block">
            <span className="block text-ui font-medium text-ink-800">{user.name}</span>
            {user.roleSummary ? (
              <span className="block text-small text-ink-500">{user.roleSummary}</span>
            ) : null}
          </span>
          <IconChevronDown
            size={16}
            className={cn('text-ink-500 transition-transform', open && 'rotate-180')}
          />
        </span>
      )}
    >
      <MenuHeader>
        <p className="truncate text-ui font-semibold text-ink-900">{user.name}</p>
        <p className="truncate text-small text-ink-500">{user.email}</p>
        <p className="mt-1 truncate text-small text-ink-500">
          {user.tenantName}
          {user.unitName ? ` · ${user.unitName}` : ''}
        </p>
      </MenuHeader>

      <MenuItem>
        <Link href="/minha-conta" className={MENU_ROW}>
          <IconUser size={18} className="text-ink-500" />
          Minha conta
        </Link>
      </MenuItem>
      <MenuItem>
        <Link href="/minha-conta#seguranca" className={MENU_ROW}>
          <IconKey size={18} className="text-ink-500" />
          Senha e sessoes
        </Link>
      </MenuItem>

      <MenuSeparator />

      <MenuItem tone="danger">
        <form action={logoutAction}>
          <button type="submit" className={cn(MENU_ROW, 'text-danger-700 hover:bg-danger-50')}>
            <IconLogout size={18} />
            Sair
          </button>
        </form>
      </MenuItem>
    </Menu>
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

  const nav = (
    <nav aria-label="Navegacao principal" className="flex flex-col gap-6 px-3 py-4">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-2 text-small font-semibold tracking-wide text-ink-500 uppercase">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const ItemIcon = NAV_ICONS[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-ui font-medium',
                      'transition-colors duration-(--duration-fast)',
                      'touch-target md:min-h-0',
                      active
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
                    )}
                  >
                    <ItemIcon size={18} className={active ? 'text-brand-600' : 'text-ink-400'} />
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
    <div className="min-h-dvh bg-(--surface-page)">
      {/* Atalho para quem navega por teclado: pula a navegacao repetida. */}
      <a
        href="#conteudo"
        className={cn(
          'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-500',
          'focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-ui focus:font-semibold',
          'focus:text-brand-700 focus:shadow-md',
        )}
      >
        Ir para o conteudo
      </a>

      {/* Sidebar — tablet e desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-ink-200 bg-white md:block">
        <div className="flex h-14 items-center border-b border-ink-200 px-5">
          <Link href="/" aria-label="Nexo56 ERP — inicio">
            <BrandMark />
          </Link>
        </div>
        {nav}
      </aside>

      {/* Gaveta — mobile */}
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Menu" side="left">
        {units.length > 1 ? (
          <div className="border-b border-ink-200 px-4 py-3">
            <p className="mb-2 text-small font-semibold tracking-wide text-ink-500 uppercase">
              Unidade ativa
            </p>
            <UnitSwitcher units={units} activeUnitId={activeUnitId} />
          </div>
        ) : null}
        {nav}
      </Drawer>

      <div className="md:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-100 flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-4 sm:px-6">
          <IconButton
            label="Abrir menu"
            className="touch-target md:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
          >
            <IconMenu />
          </IconButton>

          <div className="min-w-0 flex-1">
            <p className="truncate text-ui font-semibold text-ink-900">{user.tenantName}</p>
            {user.unitName ? (
              <p className="truncate text-small text-ink-500">{user.unitName}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <UnitSwitcher units={units} activeUnitId={activeUnitId} className="hidden lg:flex" />
            <UserMenu user={user} />
          </div>
        </header>

        <main id="conteudo" className="px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
