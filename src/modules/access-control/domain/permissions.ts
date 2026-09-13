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

  // --- Prompt 06: equipamentos e recebimento -------------------------------
  EQUIPMENT_VIEW: 'equipment.view',
  EQUIPMENT_MANAGE: 'equipment.manage',
  EQUIPMENT_INTAKE_VIEW: 'equipment_intake.view',
  EQUIPMENT_INTAKE_CREATE: 'equipment_intake.create',
  /** Anexar e remover fotos. Separada porque mexe em evidencia operacional. */
  EQUIPMENT_INTAKE_MANAGE_MEDIA: 'equipment_intake.manage_media',

  // --- Prompt 07: ordem de servico -----------------------------------------
  /**
   * Tres capacidades de NEGOCIO, nao uma por botao (item 62): consultar a
   * ordem, abrir uma nova e corrigir os dados de abertura. As acoes de
   * workflow — orcar, encomendar peca, concluir — chegam com o Prompt 08, e
   * criar permissoes para elas agora seria declarar poder sobre o que ainda
   * nao existe.
   */
  SERVICE_ORDERS_VIEW: 'service_orders.view',
  SERVICE_ORDERS_CREATE: 'service_orders.create',
  SERVICE_ORDERS_UPDATE: 'service_orders.update',

  // --- Prompt 08: workflow da ordem de servico ------------------------------
  /**
   * CAPACIDADES, NAO ESTADOS (item 71).
   *
   * Nao ha uma permissao por transicao: "liberar para conserto" e "marcar
   * falta de peca" sao a mesma capacidade de negocio — conduzir o atendimento.
   * O que ganha permissao propria e o que tem consequencia distinta: atribuir
   * responsavel, mexer em prazo, cuidar de tarefa, cancelar e finalizar.
   */
  SERVICE_ORDERS_TRANSITION: 'service_orders.transition',
  SERVICE_ORDERS_ASSIGN_TECHNICIAN: 'service_orders.assign_technician',
  SERVICE_ORDERS_MANAGE_FOLLOW_UP: 'service_orders.manage_follow_up',
  SERVICE_ORDERS_MANAGE_TASKS: 'service_orders.manage_tasks',
  /** Separada porque encerra a ordem sem conclusao e nao se desfaz. */
  SERVICE_ORDERS_CANCEL: 'service_orders.cancel',
  /** Separada porque e terminal e recebera a trava financeira do Prompt 12. */
  SERVICE_ORDERS_COMPLETE: 'service_orders.complete',
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
  {
    key: PERMISSIONS.EQUIPMENT_VIEW,
    name: 'Visualizar equipamentos',
    description: 'Consulta a lista e a ficha dos equipamentos dos clientes.',
    featureKey: 'core.equipment',
  },
  {
    key: PERMISSIONS.EQUIPMENT_MANAGE,
    name: 'Administrar equipamentos',
    description: 'Cadastra e corrige a identificacao dos equipamentos.',
    featureKey: 'core.equipment',
  },
  {
    key: PERMISSIONS.EQUIPMENT_INTAKE_VIEW,
    name: 'Visualizar recebimentos',
    description: 'Consulta as entradas de equipamentos da unidade.',
    featureKey: 'core.equipment_intake',
  },
  {
    key: PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
    name: 'Receber equipamentos',
    description: 'Registra a entrada de um equipamento na unidade.',
    featureKey: 'core.equipment_intake',
  },
  {
    key: PERMISSIONS.EQUIPMENT_INTAKE_MANAGE_MEDIA,
    name: 'Gerenciar fotos do recebimento',
    description: 'Anexa e remove fotos do equipamento e do recebimento.',
    featureKey: 'core.equipment_intake',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_VIEW,
    name: 'Visualizar Ordens de Servico',
    description: 'Consulta a lista e a ficha das Ordens de Servico da unidade.',
    featureKey: 'core.service_orders',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_CREATE,
    name: 'Abrir Ordens de Servico',
    description: 'Abre uma Ordem de Servico para um equipamento na unidade.',
    featureKey: 'core.service_orders',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_UPDATE,
    name: 'Corrigir dados de abertura',
    description: 'Corrige o relato do cliente e as observacoes internas da abertura.',
    featureKey: 'core.service_orders',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_TRANSITION,
    name: 'Conduzir o atendimento',
    description: 'Move a Ordem de Servico entre as situacoes do fluxo.',
    featureKey: 'core.service_orders',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_ASSIGN_TECHNICIAN,
    name: 'Definir tecnico responsavel',
    description: 'Atribui ou troca o tecnico responsavel pela Ordem de Servico.',
    featureKey: 'core.service_orders',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_MANAGE_FOLLOW_UP,
    name: 'Gerenciar prazo de acompanhamento',
    description: 'Reagenda o proximo ponto de atencao da Ordem de Servico.',
    featureKey: 'core.service_orders',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_MANAGE_TASKS,
    name: 'Gerenciar tarefas da Ordem de Servico',
    description: 'Conclui e cancela as tarefas operacionais geradas pelo fluxo.',
    featureKey: 'core.service_orders',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_CANCEL,
    name: 'Cancelar Ordem de Servico',
    description: 'Encerra a ordem sem conclusao, com justificativa obrigatoria.',
    featureKey: 'core.service_orders',
  },
  {
    key: PERMISSIONS.SERVICE_ORDERS_COMPLETE,
    name: 'Finalizar Ordem de Servico',
    description: 'Encerra a ordem depois de o cliente retirar o aparelho.',
    featureKey: 'core.service_orders',
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
    key: 'equipamentos',
    name: 'Equipamentos e recebimento',
    description: 'Aparelhos dos clientes e sua entrada na assistencia.',
    permissions: [
      PERMISSIONS.EQUIPMENT_VIEW,
      PERMISSIONS.EQUIPMENT_MANAGE,
      PERMISSIONS.EQUIPMENT_INTAKE_VIEW,
      PERMISSIONS.EQUIPMENT_INTAKE_CREATE,
      PERMISSIONS.EQUIPMENT_INTAKE_MANAGE_MEDIA,
    ],
  },
  {
    key: 'ordens-de-servico',
    name: 'Ordens de Servico',
    description: 'Abertura e consulta das Ordens de Servico da unidade.',
    permissions: [
      PERMISSIONS.SERVICE_ORDERS_VIEW,
      PERMISSIONS.SERVICE_ORDERS_CREATE,
      PERMISSIONS.SERVICE_ORDERS_UPDATE,
      PERMISSIONS.SERVICE_ORDERS_TRANSITION,
      PERMISSIONS.SERVICE_ORDERS_ASSIGN_TECHNICIAN,
      PERMISSIONS.SERVICE_ORDERS_MANAGE_FOLLOW_UP,
      PERMISSIONS.SERVICE_ORDERS_MANAGE_TASKS,
      PERMISSIONS.SERVICE_ORDERS_CANCEL,
      PERMISSIONS.SERVICE_ORDERS_COMPLETE,
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
