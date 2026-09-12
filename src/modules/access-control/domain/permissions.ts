/**
 * Catalogo de permissoes da fundacao (Prompt 01, item 18).
 *
 * Padrao de nomenclatura: `<recurso>.<acao>`, minusculo, sem acento.
 * `view` = leitura; `manage` = criar/editar/desativar.
 *
 * Permissoes dos modulos de negocio (OS, estoque, financeiro...) NAO entram
 * aqui — cada modulo declara as suas no seu proprio prompt.
 */

export const PERMISSIONS = {
  ADMIN_ACCESS: 'admin.access',
  USERS_VIEW: 'users.view',
  USERS_MANAGE: 'users.manage',
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',
  UNITS_VIEW: 'units.view',
  UNITS_MANAGE: 'units.manage',
  FEATURES_VIEW: 'features.view',
  FEATURES_MANAGE: 'features.manage',
  AUDIT_VIEW: 'audit.view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  key: PermissionKey;
  name: string;
  description: string;
  /** Feature a que a permissao pertence (agrupamento e Effective Access). */
  featureKey: string;
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  {
    key: PERMISSIONS.ADMIN_ACCESS,
    name: 'Acessar administracao',
    description: 'Acessa a area de administracao estrutural do tenant.',
    featureKey: 'core.access_control',
  },
  {
    key: PERMISSIONS.USERS_VIEW,
    name: 'Visualizar usuarios',
    description: 'Consulta a lista de usuarios da empresa.',
    featureKey: 'core.users',
  },
  {
    key: PERMISSIONS.USERS_MANAGE,
    name: 'Administrar usuarios',
    description: 'Cria, edita e desativa usuarios da empresa.',
    featureKey: 'core.users',
  },
  {
    key: PERMISSIONS.ROLES_VIEW,
    name: 'Visualizar perfis',
    description: 'Consulta perfis de acesso e suas permissoes.',
    featureKey: 'core.access_control',
  },
  {
    key: PERMISSIONS.ROLES_MANAGE,
    name: 'Administrar perfis',
    description: 'Cria e altera perfis de acesso e permissoes.',
    featureKey: 'core.access_control',
  },
  {
    key: PERMISSIONS.UNITS_VIEW,
    name: 'Visualizar unidades',
    description: 'Consulta as unidades da empresa.',
    featureKey: 'core.tenancy',
  },
  {
    key: PERMISSIONS.UNITS_MANAGE,
    name: 'Administrar unidades',
    description: 'Cria e altera unidades da empresa.',
    featureKey: 'platform.multi_unit',
  },
  {
    key: PERMISSIONS.FEATURES_VIEW,
    name: 'Visualizar modulos',
    description: 'Consulta modulos e funcionalidades disponiveis a empresa.',
    featureKey: 'core.features',
  },
  {
    key: PERMISSIONS.FEATURES_MANAGE,
    name: 'Administrar modulos',
    description: 'Ativa e desativa modulos e funcionalidades da empresa.',
    featureKey: 'core.features',
  },
  {
    key: PERMISSIONS.AUDIT_VIEW,
    name: 'Visualizar auditoria',
    description: 'Consulta a trilha de auditoria da empresa.',
    featureKey: 'core.audit',
  },
];

/** Papeis estruturais criados no bootstrap de cada tenant. */
export const SYSTEM_ROLES = {
  ADMIN: 'admin',
} as const;

export const SYSTEM_ROLE_DEFINITIONS = [
  {
    key: SYSTEM_ROLES.ADMIN,
    name: 'Administrador',
    description: 'Acesso administrativo completo a estrutura da empresa.',
    permissions: Object.values(PERMISSIONS) as PermissionKey[],
  },
] as const;
