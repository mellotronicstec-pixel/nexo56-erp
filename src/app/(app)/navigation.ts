import { PERMISSIONS, type PermissionKey } from '@/modules/access-control/domain/permissions';
import { FEATURES } from '@/modules/features/domain/catalog';

/**
 * Navegacao consciente de modularidade (Prompt 01, item 57; Prompt 04, itens
 * 34 a 37).
 *
 * Cada item declara a feature e a permissao que exige. A visibilidade sai do
 * Effective Access — nunca de `isAdmin ? tudo : nada`. Quando um modulo esta
 * indisponivel, o item some do menu em vez de levar a uma tela quebrada
 * (Prompt 00, item 118).
 *
 * O menu NAO lista modulos inexistentes (Prompt 01, itens 56 e 82; Prompt 04,
 * item 117): Clientes, Equipamentos, Ordens de Servico, Estoque, Compras,
 * Financeiro, Garantias, Agenda e BI entrarao AQUI, cada um no seu prompt,
 * com a feature e a permissao correspondentes. A estrutura de secoes ja
 * acomoda esse crescimento sem reescrita.
 */

/**
 * Chave do icone, NAO o componente.
 *
 * O menu e montado no servidor (layout) e renderizado no cliente (shell), e a
 * fronteira entre os dois so aceita dados serializaveis — funcao de componente
 * nao atravessa. Entao o servidor manda o nome e o shell resolve o desenho.
 */
export type NavIconKey =
  'user' | 'users' | 'shield' | 'building' | 'modules' | 'history' | 'customers';

export interface NavItem {
  href: string;
  label: string;
  featureKey: string;
  /** Nulo = basta estar autenticado e ter a feature disponivel. */
  permission: PermissionKey | null;
  icon: NavIconKey;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Operacao',
    items: [
      {
        href: '/clientes',
        label: 'Clientes',
        featureKey: FEATURES.CORE_CUSTOMERS,
        permission: PERMISSIONS.CUSTOMERS_VIEW,
        icon: 'customers',
      },
    ],
  },
  {
    title: 'Minha area',
    items: [
      {
        href: '/minha-conta',
        label: 'Minha conta',
        featureKey: FEATURES.CORE_AUTH,
        // Toda pessoa autenticada gerencia a propria senha e sessoes.
        permission: null,
        icon: 'user',
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
        icon: 'users',
      },
      {
        href: '/administracao/perfis',
        label: 'Perfis de acesso',
        featureKey: FEATURES.CORE_ACCESS_CONTROL,
        permission: PERMISSIONS.ROLES_VIEW,
        icon: 'shield',
      },
      {
        href: '/administracao/unidades',
        label: 'Unidades',
        featureKey: FEATURES.PLATFORM_MULTI_UNIT,
        permission: PERMISSIONS.UNITS_VIEW,
        icon: 'building',
      },
      {
        href: '/administracao/modulos',
        label: 'Modulos e funcionalidades',
        featureKey: FEATURES.CORE_FEATURES,
        permission: PERMISSIONS.FEATURES_VIEW,
        icon: 'modules',
      },
      {
        href: '/administracao/auditoria',
        label: 'Auditoria',
        featureKey: FEATURES.CORE_AUDIT,
        permission: PERMISSIONS.AUDIT_VIEW,
        icon: 'history',
      },
    ],
  },
];

/**
 * Rotulos para a trilha de navegacao (Prompt 04, item 39).
 *
 * Mapeia segmento de URL -> nome em portugues. Segmentos que sao ID (a ficha
 * de um usuario, por exemplo) nao entram aqui: quem renderiza a pagina conhece
 * o nome real do registro e passa a trilha completa.
 */
export const BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
  clientes: 'Clientes',
  administracao: 'Administracao',
  usuarios: 'Usuarios',
  perfis: 'Perfis de acesso',
  unidades: 'Unidades',
  modulos: 'Modulos e funcionalidades',
  auditoria: 'Auditoria',
  'minha-conta': 'Minha conta',
};
