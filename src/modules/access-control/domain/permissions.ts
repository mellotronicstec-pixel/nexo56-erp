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
  /** Gerenciar unidades e perfis de OUTROS usuarios — separada de users.manage
   *  justamente porque conceder acesso e mais perigoso que editar um nome. */
  USERS_MANAGE_ACCESS: 'users.manage_access',
  USERS_RESET_PASSWORD: 'users.reset_password',
  ROLES_VIEW: 'roles.view',
  ROLES_MANAGE: 'roles.manage',
  /** Alterar QUAIS permissoes um perfil concede. E o vetor classico de
   *  escalonamento de privilegio, entao nao fica embutida em roles.manage. */
  ROLES_MANAGE_PERMISSIONS: 'roles.manage_permissions',
  UNITS_VIEW: 'units.view',
  UNITS_MANAGE: 'units.manage',
  FEATURES_VIEW: 'features.view',
  FEATURES_MANAGE: 'features.manage',
  AUDIT_VIEW: 'audit.view',
  SESSIONS_REVOKE: 'sessions.revoke',

  // --- Prompt 05: clientes -------------------------------------------------
  CUSTOMERS_VIEW: 'customers.view',
  /** Criar e editar cadastro. Segue a convencao `view`/`manage` do catalogo. */
  CUSTOMERS_MANAGE: 'customers.manage',
  /** Ativar e inativar — separada porque muda a operacao, nao o cadastro. */
  CUSTOMERS_CHANGE_STATUS: 'customers.change_status',
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
    key: PERMISSIONS.USERS_MANAGE_ACCESS,
    name: 'Gerenciar acesso de usuarios',
    description: 'Vincula usuarios a unidades e atribui perfis de acesso.',
    featureKey: 'core.access_control',
  },
  {
    key: PERMISSIONS.USERS_RESET_PASSWORD,
    name: 'Redefinir senha de usuarios',
    description: 'Inicia a redefinicao de senha de outro usuario da empresa.',
    featureKey: 'core.auth',
  },
  {
    key: PERMISSIONS.SESSIONS_REVOKE,
    name: 'Encerrar sessoes de usuarios',
    description: 'Encerra sessoes ativas de outros usuarios da empresa.',
    featureKey: 'core.auth',
  },
  {
    key: PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
    name: 'Alterar permissoes de perfis',
    description: 'Altera quais permissoes cada perfil de acesso concede.',
    featureKey: 'core.access_control',
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
  {
    key: PERMISSIONS.CUSTOMERS_VIEW,
    name: 'Visualizar clientes',
    description: 'Consulta a lista e a ficha dos clientes da empresa.',
    featureKey: 'core.customers',
  },
  {
    key: PERMISSIONS.CUSTOMERS_MANAGE,
    name: 'Administrar clientes',
    description: 'Cadastra e edita clientes, contatos e enderecos.',
    featureKey: 'core.customers',
  },
  {
    key: PERMISSIONS.CUSTOMERS_CHANGE_STATUS,
    name: 'Ativar e inativar clientes',
    description: 'Altera a situacao do cliente sem apagar o cadastro.',
    featureKey: 'core.customers',
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

/**
 * Perfis iniciais oferecidos ao tenant (Prompt 03, item 12).
 *
 * Sao criados SEM permissoes: hoje o catalogo so tem capacidades estruturais
 * (usuarios, perfis, unidades, modulos, auditoria), e atribuir qualquer uma
 * delas a "Tecnico" ou "Atendente" seria arbitrario. Cada modulo posterior
 * (OS, Estoque, Financeiro) acrescenta as suas capacidades reais, e entao
 * estes perfis passam a fazer sentido pratico.
 *
 * Deliberadamente NAO sao `is_system`: a empresa pode renomear, ajustar ou
 * excluir livremente. Apenas o Administrador e protegido, porque e o caminho
 * administrativo do tenant (item 52).
 */
export const STARTER_ROLE_DEFINITIONS = [
  {
    key: 'atendente',
    name: 'Atendente',
    description:
      'Perfil preparado para o atendimento. As capacidades serao ampliadas pelos modulos de Clientes e Ordens de Servico.',
  },
  {
    key: 'tecnico',
    name: 'Tecnico',
    description:
      'Perfil preparado para a operacao tecnica. As capacidades serao ampliadas pelos modulos de Ordens de Servico e Estoque.',
  },
  {
    key: 'financeiro',
    name: 'Financeiro',
    description:
      'Perfil preparado para a area financeira. As capacidades serao ampliadas pelo modulo Financeiro.',
  },
] as const;

// ---------------------------------------------------------------------------
// Escopo de atribuicao (Prompt 03, itens 15 a 17)
// ---------------------------------------------------------------------------

/**
 * Escopo em que uma ATRIBUICAO de perfil vale.
 *
 * O escopo pertence a atribuicao, nao ao perfil: o mesmo perfil "Tecnico" pode
 * valer no tenant inteiro para uma pessoa e apenas na Unidade Norte para outra.
 *
 * TENANT — o perfil vale nas unidades que o usuario ja acessa. NAO concede
 *          vinculo a novas unidades (item 16).
 * UNIT   — o perfil vale somente na unidade indicada, e exige vinculo previo
 *          naquela unidade (item 20).
 */
export const ROLE_SCOPES = {
  TENANT: 'TENANT',
  UNIT: 'UNIT',
} as const;

export type RoleScope = (typeof ROLE_SCOPES)[keyof typeof ROLE_SCOPES];

/** Rotulo em portugues; a interface nunca mostra TENANT/UNIT cru (item 70). */
export const ROLE_SCOPE_LABEL: Record<RoleScope, string> = {
  TENANT: 'Todas as unidades autorizadas',
  UNIT: 'Somente uma unidade',
};

// ---------------------------------------------------------------------------
// Agrupamento para a interface (item 69)
// ---------------------------------------------------------------------------

/**
 * Areas usadas para agrupar permissoes na tela, para o administrador nao
 * encarar uma parede de chaves tecnicas.
 */
export const PERMISSION_GROUPS = [
  {
    key: 'usuarios',
    name: 'Usuarios',
    description: 'Cadastro, situacao e acesso das pessoas da empresa.',
    permissions: [
      PERMISSIONS.USERS_VIEW,
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.USERS_MANAGE_ACCESS,
      PERMISSIONS.USERS_RESET_PASSWORD,
      PERMISSIONS.SESSIONS_REVOKE,
    ],
  },
  {
    key: 'perfis',
    name: 'Perfis de acesso',
    description: 'Quais capacidades cada perfil concede.',
    permissions: [
      PERMISSIONS.ROLES_VIEW,
      PERMISSIONS.ROLES_MANAGE,
      PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
      PERMISSIONS.ADMIN_ACCESS,
    ],
  },
  {
    key: 'unidades',
    name: 'Unidades',
    description: 'Estrutura de unidades da empresa.',
    permissions: [PERMISSIONS.UNITS_VIEW, PERMISSIONS.UNITS_MANAGE],
  },
  {
    key: 'clientes',
    name: 'Clientes',
    description: 'Cadastro de clientes da empresa.',
    permissions: [
      PERMISSIONS.CUSTOMERS_VIEW,
      PERMISSIONS.CUSTOMERS_MANAGE,
      PERMISSIONS.CUSTOMERS_CHANGE_STATUS,
    ],
  },
  {
    key: 'plataforma',
    name: 'Modulos e auditoria',
    description: 'Configuracao de funcionalidades e trilha de auditoria.',
    permissions: [PERMISSIONS.FEATURES_VIEW, PERMISSIONS.FEATURES_MANAGE, PERMISSIONS.AUDIT_VIEW],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}>;

/**
 * Permissoes consideradas de ALTO RISCO: concedem, direta ou indiretamente, a
 * capacidade de ampliar o proprio acesso ou o de terceiros.
 *
 * Usadas pela politica anti-escalonamento (item 57): ninguem concede a um
 * perfil uma permissao de alto risco que a propria pessoa nao possua.
 */
/*
 * NOTA sobre Clientes: `customers.*` NAO entra nesta lista. Alto risco aqui
 * significa "amplia acesso, direta ou indiretamente" — e administrar clientes
 * nao concede capacidade a ninguem. Elas sao permissoes de DADO PESSOAL, o que
 * e uma preocupacao real e diferente, tratada pelo RBAC e pela auditoria.
 */
export const HIGH_RISK_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.ADMIN_ACCESS,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.USERS_MANAGE_ACCESS,
  PERMISSIONS.USERS_RESET_PASSWORD,
  PERMISSIONS.ROLES_MANAGE,
  PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
  PERMISSIONS.SESSIONS_REVOKE,
];

/**
 * Permissoes que caracterizam um administrador capaz de gerir o acesso da
 * empresa. Usadas na protecao contra lockout (item 53): o tenant nunca pode
 * ficar sem alguem que detenha TODAS elas.
 */
export const ADMINISTRATIVE_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.USERS_MANAGE_ACCESS,
  PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
];

export function isHighRisk(permission: string): boolean {
  return (HIGH_RISK_PERMISSIONS as readonly string[]).includes(permission);
}
