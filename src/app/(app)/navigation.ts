import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';

/**
 * Navegacao consciente de modularidade (Prompt 01, item 57).
 *
 * Cada item declara a feature e a permissao que exige. A visibilidade sai do
 * Effective Access — nunca de `isAdmin ? tudo : nada`. Quando um modulo esta
 * indisponivel, o item some do menu em vez de levar a uma tela quebrada
 * (Prompt 00, item 118).
 *
 * O menu NAO lista modulos inexistentes (Prompt 01, itens 56 e 82): so entram
 * aqui telas que existem de verdade nesta fundacao.
 */

export interface NavItem {
  href: string;
  label: string;
  featureKey: string;
  /** Nulo = basta estar autenticado e ter a feature disponivel. */
  permission: PermissionKey | null;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Minha area',
    items: [
      {
        href: '/minha-conta',
        label: 'Minha conta',
        featureKey: FEATURES.CORE_AUTH,
        // Toda pessoa autenticada gerencia a propria senha e sessoes.
        permission: null,
      },
    ],
  },
  {
    title: 'Administracao',
    items: [
      {
        href: '/administracao/usuarios',
        label: 'Usuarios',
        featureKey: FEATURES.CORE_USERS,
        permission: PERMISSIONS.USERS_VIEW,
      },
      {
        href: '/administracao/perfis',
        label: 'Perfis e permissoes',
        featureKey: FEATURES.CORE_ACCESS_CONTROL,
        permission: PERMISSIONS.ROLES_VIEW,
      },
      {
        href: '/administracao/unidades',
        label: 'Unidades',
        featureKey: FEATURES.PLATFORM_MULTI_UNIT,
        permission: PERMISSIONS.UNITS_VIEW,
      },
      {
        href: '/administracao/modulos',
        label: 'Modulos e funcionalidades',
        featureKey: FEATURES.CORE_FEATURES,
        permission: PERMISSIONS.FEATURES_VIEW,
      },
      {
        href: '/administracao/auditoria',
        label: 'Auditoria',
        featureKey: FEATURES.CORE_AUDIT,
        permission: PERMISSIONS.AUDIT_VIEW,
      },
    ],
  },
];
