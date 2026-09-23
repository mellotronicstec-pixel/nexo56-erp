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

  // --- Prompt 09: orcamentos ------------------------------------------------
  /**
   * CAPACIDADES COMERCIAIS, e nao uma permissao por botao (item 71).
   *
   * O corte aqui separa quem MONTA a proposta de quem a FORMALIZA e de quem
   * REGISTRA A DECISAO DO CLIENTE. Numa assistencia isso costuma ser gente
   * diferente: o tecnico lanca os itens, o balcao envia, e aprovar ou recusar
   * em nome do cliente e responsabilidade de quem falou com ele.
   */
  QUOTES_VIEW: 'quotes.view',
  QUOTES_CREATE: 'quotes.create',
  /** Mexer nos valores enquanto e rascunho. Depois de enviado, ninguem edita. */
  QUOTES_UPDATE_DRAFT: 'quotes.update_draft',
  /** Formaliza a proposta e move a Ordem de Servico. */
  QUOTES_SEND: 'quotes.send',
  /** Registra a decisao do cliente; leva a OS para o conserto. */
  QUOTES_APPROVE: 'quotes.approve',
  QUOTES_REJECT: 'quotes.reject',
  QUOTES_CANCEL: 'quotes.cancel',

  // --- Prompt 10: estoque e pecas -------------------------------------------
  /**
   * O CORTE AQUI E POR CONSEQUENCIA, nao por botao (itens 78 e 79).
   *
   * Consultar saldo e uma coisa; mexer no catalogo da empresa inteira e outra;
   * e AJUSTAR saldo — reescrever quanto o sistema acredita existir — e a acao
   * que uma assistencia quer nas maos de pouca gente. Entrada, saida, reserva
   * e transferencia sao separadas porque, numa loja, sao papeis diferentes:
   * quem recebe mercadoria nao e necessariamente quem entrega peca ao tecnico.
   *
   * NAO existe `inventory.count`: contagem de inventario nao foi implementada
   * (item 57), e declarar a permissao faria o catalogo prometer capacidade
   * inexistente.
   */
  INVENTORY_VIEW: 'inventory.view',
  /** Cadastro da peca. TENANT: vale para todas as unidades (item 81). */
  INVENTORY_CATALOG_MANAGE: 'inventory.catalog_manage',
  /** Prateleiras e gavetas da unidade. Configuracao fisica, nao catalogo. */
  INVENTORY_LOCATIONS_MANAGE: 'inventory.locations_manage',
  INVENTORY_RECEIVE: 'inventory.receive',
  INVENTORY_ISSUE: 'inventory.issue',
  INVENTORY_RESERVE: 'inventory.reserve',
  INVENTORY_TRANSFER: 'inventory.transfer',
  /** Separada e sensivel: reescreve o saldo e exige motivo (itens 55 e 107). */
  INVENTORY_ADJUST: 'inventory.adjust',

  // --- Prompt 11: fornecedores e compras ------------------------------------
  /**
   * DOIS RECURSOS, E NAO UM (itens 46 e 47).
   *
   * Fornecedor e cadastro do TENANT — quem administra a lista de fornecedores
   * da empresa nao e, necessariamente, quem compra. Compra e operacao de
   * UNIDADE: o pedido tem destino, e quem opera a loja do centro nao recebe
   * mercadoria da loja do bairro.
   *
   * O corte dentro de compras separa o que tem CONSEQUENCIA DIFERENTE: montar
   * o pedido, autorizar a compra, receber a mercadoria (que vira estoque de
   * verdade) e cancelar o que sobrou.
   */
  SUPPLIERS_VIEW: 'suppliers.view',
  SUPPLIERS_MANAGE: 'suppliers.manage',

  PURCHASES_VIEW: 'purchases.view',
  /** Registrar necessidade e montar pedido em rascunho. */
  PURCHASES_CREATE: 'purchases.create',
  PURCHASES_UPDATE: 'purchases.update',
  /** Autoriza a compra. Quem monta nao precisa ser quem autoriza (item 17). */
  PURCHASES_APPROVE: 'purchases.approve',
  /**
   * RECEBER E DAR ENTRADA NO ESTOQUE.
   *
   * Quem tem esta permissao cria movimentacao de estoque na unidade do pedido,
   * pelo servico oficial do Prompt 10. Nao e um atalho: e a forma correta de a
   * mercadoria comprada virar saldo, e esta escrito assim em
   * docs/modules/purchasing/permissions.md.
   */
  PURCHASES_RECEIVE: 'purchases.receive',
  PURCHASES_CANCEL: 'purchases.cancel',

  /**
   * FINANCEIRO (Prompt 12, itens 51 e 52).
   *
   * Informacao financeira e sensivel de um jeito diferente do resto do ERP: o
   * tecnico precisa ver a OS, e nao precisa ver o caixa, a margem, as contas
   * bancarias nem quanto a empresa paga aos fornecedores. Por isso
   * `service_orders.view` NAO concede `finance.view`, e a separacao esta
   * escrita em docs/modules/finance/permissions.md.
   *
   * O corte segue o que tem CONSEQUENCIA DIFERENTE: consultar, administrar
   * obrigacoes, movimentar dinheiro que entra, movimentar dinheiro que sai,
   * desfazer o que ja foi movimentado, e operar a gaveta do balcao.
   */
  FINANCE_VIEW: 'finance.view',
  FINANCE_RECEIVABLES_MANAGE: 'finance.receivables.manage',
  FINANCE_PAYABLES_MANAGE: 'finance.payables.manage',
  /** Dinheiro do cliente ENTRANDO. */
  FINANCE_RECEIVE: 'finance.receive',
  /** Dinheiro da empresa SAINDO. Nao e a mesma capacidade de receber. */
  FINANCE_PAY: 'finance.pay',
  /**
   * DESFAZER O QUE JA ACONTECEU.
   *
   * Estorno nao apaga nada: cria contramovimento e devolve o saldo em aberto.
   * Ainda assim e a permissao mais sensivel do modulo, porque e a unica que
   * mexe em dinheiro ja registrado.
   */
  FINANCE_REVERSE: 'finance.reverse',
  FINANCE_CASH_OPEN: 'finance.cash.open',
  FINANCE_CASH_CLOSE: 'finance.cash.close',
  /** Suprimento e sangria: dinheiro entrando e saindo da gaveta sem titulo. */
  FINANCE_CASH_ADJUST: 'finance.cash.adjust',
  FINANCE_SETTINGS_MANAGE: 'finance.settings.manage',

  // --- Garantias (Prompt 13, item 68) --------------------------------------
  /**
   * DEZ CHAVES, e a granularidade tem uma razao por linha.
   *
   * Ver uma garantia e trabalho de balcao. EMITIR e o ato que passa a valer
   * contra a loja. RECLASSIFICAR exige autoridade tecnica — e a permissao
   * existe justamente para que essa autoridade NAO seja verificada pelo nome
   * do cargo (item 69), que muda de empresa para empresa e nao e autorizacao.
   *
   * Os CUSTOS ficam separados de propósito (item 70): quem atende o cliente
   * precisa saber se a garantia vale, e nao precisa saber quanto ela custou.
   */
  WARRANTIES_VIEW: 'warranties.view',
  WARRANTIES_CREATE: 'warranties.create',
  WARRANTIES_ISSUE: 'warranties.issue',
  WARRANTIES_RETURN_CREATE: 'warranties.return.create',
  WARRANTIES_RECLASSIFY: 'warranties.reclassify',
  WARRANTIES_CANCEL: 'warranties.cancel',
  WARRANTIES_REVOKE: 'warranties.revoke',
  WARRANTIES_COSTS_VIEW: 'warranties.costs.view',
  WARRANTIES_COSTS_MANAGE: 'warranties.costs.manage',
  WARRANTIES_SETTINGS_MANAGE: 'warranties.settings.manage',

  // --- Prompt 14: agenda e tarefas -----------------------------------------
  /**
   * CINCO CHAVES, e nao uma por botao (item 79).
   *
   * O corte segue o que muda de MAO na operacao: consultar a agenda, criar
   * trabalho, passar trabalho para outra pessoa, encerrar trabalho alheio e
   * marcar compromisso. Concluir a PROPRIA tarefa nao esta nesta lista de
   * proposito — exigir permissao administrativa para o tecnico dar baixa no
   * que ele mesmo fez transformaria a ferramenta em obstaculo.
   */
  AGENDA_VIEW: 'agenda.view',
  AGENDA_TASKS_CREATE: 'agenda.tasks.create',
  /** Editar, concluir e cancelar tarefa de OUTRA pessoa. */
  AGENDA_TASKS_MANAGE: 'agenda.tasks.manage',
  /** Atribuir a terceiro: mexe na fila de trabalho de outra pessoa (item 82). */
  AGENDA_TASKS_ASSIGN: 'agenda.tasks.assign',
  AGENDA_APPOINTMENTS_MANAGE: 'agenda.appointments.manage',

  /**
   * UMA chave so para a Central, de proposito.
   *
   * Ela governa o ACESSO A TELA. O que aparece dentro continua governado pelas
   * permissoes de origem: as filas de OS exigem `service_orders.view`, os itens
   * da Agenda exigem `agenda.view`, e cada acao rapida exige a permissao da
   * acao oficial correspondente.
   *
   * NAO existe `work_center.team_view`. Quem pode listar as OS da unidade em
   * `/ordens-de-servico` ja ve exatamente os mesmos registros; uma chave extra
   * para a Central esconderia na cozinha o que ja esta servido no salao — seria
   * teatro de seguranca, nao seguranca.
   */
  WORK_CENTER_VIEW: 'work_center.view',

  /**
   * TRES PERMISSOES, E NAO SEIS (Prompt 16, itens 79 a 84).
   *
   * A tentacao seria separar `send`, `retry` e `cancel`. Mas reenviar e
   * enviar de novo, e cancelar uma mensagem que ainda nao saiu e desfazer o
   * proprio envio — as tres sao a mesma autoridade: decidir o que a empresa
   * fala com o cliente. Separa-las criaria o cargo absurdo de quem pode
   * mandar e nao pode consertar o que mandou.
   *
   * O que E outra autoridade e MEXER NO MODELO: quem edita um template muda o
   * texto de todas as mensagens futuras de todas as unidades, sem enviar nada.
   * Isso e configuracao da empresa, e tem chave propria.
   */
  COMMUNICATIONS_VIEW: 'communications.view',
  COMMUNICATIONS_SEND: 'communications.send',
  COMMUNICATIONS_TEMPLATES_MANAGE: 'communications.templates.manage',

  /**
   * UMA chave so para o Painel (Prompt 18), pelo MESMO motivo de
   * `work_center.view`: ela governa o ACESSO A TELA, nao os dados dentro
   * dela. Um cartao financeiro so aparece — e so e CONSULTADO — para quem
   * tambem tem `finance.view`; um cartao de garantia exige `warranties.view`;
   * e assim por diante. `analytics.view` nunca supera a permissao de
   * dominio: ela e condicao NECESSARIA para abrir o Painel, nunca suficiente
   * para ver um numero especifico dentro dele.
   */
  ANALYTICS_VIEW: 'analytics.view',
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

  // --- Prompt 09: orcamentos ------------------------------------------------
  {
    key: PERMISSIONS.QUOTES_VIEW,
    name: 'Consultar orcamentos',
    description: 'Ve os orcamentos das Ordens de Servico da unidade.',
    featureKey: 'core.quotes',
  },
  {
    key: PERMISSIONS.QUOTES_CREATE,
    name: 'Criar orcamento',
    description: 'Abre um novo orcamento ou uma revisao para a Ordem de Servico.',
    featureKey: 'core.quotes',
  },
  {
    key: PERMISSIONS.QUOTES_UPDATE_DRAFT,
    name: 'Editar rascunho de orcamento',
    description: 'Altera itens, valores e observacoes enquanto o orcamento e rascunho.',
    featureKey: 'core.quotes',
  },
  {
    key: PERMISSIONS.QUOTES_SEND,
    name: 'Enviar orcamento',
    description: 'Formaliza a proposta ao cliente e leva a Ordem de Servico para aprovacao.',
    featureKey: 'core.quotes',
  },
  {
    key: PERMISSIONS.QUOTES_APPROVE,
    name: 'Registrar aprovacao de orcamento',
    description: 'Registra que o cliente aprovou e libera a Ordem de Servico para conserto.',
    featureKey: 'core.quotes',
  },
  {
    key: PERMISSIONS.QUOTES_REJECT,
    name: 'Registrar recusa de orcamento',
    description: 'Registra que o cliente recusou a proposta, com o motivo.',
    featureKey: 'core.quotes',
  },
  {
    key: PERMISSIONS.QUOTES_CANCEL,
    name: 'Cancelar orcamento',
    description: 'Descarta um rascunho ou retira uma proposta antes da decisao do cliente.',
    featureKey: 'core.quotes',
  },
  {
    key: PERMISSIONS.INVENTORY_VIEW,
    name: 'Visualizar estoque',
    description: 'Consulta pecas, saldos, reservas, localizacoes e movimentacoes.',
    featureKey: 'operations.inventory',
  },
  {
    key: PERMISSIONS.INVENTORY_CATALOG_MANAGE,
    name: 'Administrar catalogo de pecas',
    description: 'Cria, edita e inativa pecas do catalogo da empresa.',
    featureKey: 'operations.inventory',
  },
  {
    key: PERMISSIONS.INVENTORY_LOCATIONS_MANAGE,
    name: 'Administrar localizacoes de estoque',
    description: 'Cria, edita e inativa as localizacoes fisicas da unidade.',
    featureKey: 'operations.inventory',
  },
  {
    key: PERMISSIONS.INVENTORY_RECEIVE,
    name: 'Registrar entrada de estoque',
    description: 'Registra entrada de pecas no estoque da unidade.',
    featureKey: 'operations.inventory',
  },
  {
    key: PERMISSIONS.INVENTORY_ISSUE,
    name: 'Registrar saida de estoque',
    description: 'Registra saida de pecas, com ou sem vinculo a uma Ordem de Servico.',
    featureKey: 'operations.inventory',
  },
  {
    key: PERMISSIONS.INVENTORY_RESERVE,
    name: 'Reservar e liberar pecas',
    description: 'Reserva pecas para uma Ordem de Servico e libera o que nao foi consumido.',
    featureKey: 'operations.inventory',
  },
  {
    key: PERMISSIONS.INVENTORY_TRANSFER,
    name: 'Transferir estoque entre unidades',
    description: 'Move pecas de uma unidade para outra da mesma empresa.',
    featureKey: 'operations.inventory',
  },
  {
    key: PERMISSIONS.INVENTORY_ADJUST,
    name: 'Ajustar saldo de estoque',
    description: 'Corrige o saldo fisico mediante motivo obrigatorio. Acao sensivel.',
    featureKey: 'operations.inventory',
  },
  {
    key: PERMISSIONS.SUPPLIERS_VIEW,
    name: 'Visualizar fornecedores',
    description: 'Consulta a lista e a ficha dos fornecedores da empresa.',
    featureKey: 'operations.purchasing',
  },
  {
    key: PERMISSIONS.SUPPLIERS_MANAGE,
    name: 'Administrar fornecedores',
    description: 'Cria, edita e inativa fornecedores, contatos e dados comerciais.',
    featureKey: 'operations.purchasing',
  },
  {
    key: PERMISSIONS.PURCHASES_VIEW,
    name: 'Visualizar compras',
    description: 'Consulta necessidades, pedidos de compra e recebimentos da unidade.',
    featureKey: 'operations.purchasing',
  },
  {
    key: PERMISSIONS.PURCHASES_CREATE,
    name: 'Registrar necessidades e pedidos',
    description: 'Registra necessidade de compra e monta pedido em rascunho.',
    featureKey: 'operations.purchasing',
  },
  {
    key: PERMISSIONS.PURCHASES_UPDATE,
    name: 'Alterar pedido de compra',
    description: 'Altera itens, custos e dados comerciais de um pedido em rascunho.',
    featureKey: 'operations.purchasing',
  },
  {
    key: PERMISSIONS.PURCHASES_APPROVE,
    name: 'Aprovar e realizar compra',
    description: 'Autoriza a compra e registra que o pedido foi realizado ao fornecedor.',
    featureKey: 'operations.purchasing',
  },
  {
    key: PERMISSIONS.PURCHASES_RECEIVE,
    name: 'Receber compra',
    description:
      'Registra o recebimento e da entrada da mercadoria no estoque da unidade do pedido.',
    featureKey: 'operations.purchasing',
  },
  {
    key: PERMISSIONS.PURCHASES_CANCEL,
    name: 'Cancelar compra',
    description: 'Cancela o pedido e o saldo ainda pendente. Nao desfaz o que ja foi recebido.',
    featureKey: 'operations.purchasing',
  },
  {
    key: PERMISSIONS.FINANCE_VIEW,
    name: 'Visualizar financeiro',
    description: 'Consulta contas a receber, contas a pagar, caixa e fluxo financeiro da unidade.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_RECEIVABLES_MANAGE,
    name: 'Administrar contas a receber',
    description: 'Cria, edita e cancela cobrancas de clientes, com parcelamento.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_PAYABLES_MANAGE,
    name: 'Administrar contas a pagar',
    description: 'Cria, edita e cancela contas a pagar e despesas da empresa.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_RECEIVE,
    name: 'Registrar recebimento',
    description:
      'Registra dinheiro do cliente entrando: gera liquidacao e movimento na conta financeira.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_PAY,
    name: 'Registrar pagamento',
    description:
      'Registra dinheiro da empresa saindo para fornecedor ou despesa. Nao movimenta estoque.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_REVERSE,
    name: 'Estornar liquidacao',
    description:
      'Desfaz um recebimento ou pagamento por contramovimento, com motivo. Acao sensivel.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_CASH_OPEN,
    name: 'Abrir caixa',
    description: 'Abre a sessao de caixa da unidade, informando o valor inicial da gaveta.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_CASH_CLOSE,
    name: 'Fechar caixa',
    description: 'Fecha a sessao, informa o valor contado e registra a diferenca.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_CASH_ADJUST,
    name: 'Suprimento e sangria',
    description: 'Coloca ou retira dinheiro da gaveta fora de um titulo, com motivo.',
    featureKey: 'finance.core',
  },
  {
    key: PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    name: 'Configurar financeiro',
    description: 'Administra contas financeiras, formas de pagamento e categorias.',
    featureKey: 'finance.core',
  },

  {
    key: PERMISSIONS.WARRANTIES_VIEW,
    name: 'Ver garantias',
    description: 'Consulta garantias, vigencia, cobertura e retornos.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_CREATE,
    name: 'Criar garantias',
    description: 'Cria garantias e define a cobertura antes da emissao.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_ISSUE,
    name: 'Emitir garantias',
    description: 'Emite a garantia e gera o certificado. E o ato que passa a valer contra a loja.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_RETURN_CREATE,
    name: 'Registrar retorno em garantia',
    description:
      'Registra que o aparelho voltou e cria a Ordem de Servico de garantia quando cabivel.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_RECLASSIFY,
    name: 'Reclassificar garantia para orcamento',
    description:
      'Autoridade TECNICA para concluir que o defeito nao esta coberto e mandar a Ordem de Servico para o fluxo comercial.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_CANCEL,
    name: 'Cancelar garantia',
    description: 'Cancela garantia emitida por engano, antes de produzir efeito.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_REVOKE,
    name: 'Revogar garantia',
    description: 'Revoga cobertura vigente por fato posterior, como violacao de lacre.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_COSTS_VIEW,
    name: 'Ver custos de garantia',
    description: 'Consulta quanto o atendimento em garantia custou a loja.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_COSTS_MANAGE,
    name: 'Registrar custos de garantia',
    description: 'Registra mao de obra, peca, terceirizado e frete gastos em garantia.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.WARRANTIES_SETTINGS_MANAGE,
    name: 'Configurar garantias',
    description: 'Administra as politicas de garantia da empresa.',
    featureKey: 'operations.warranties',
  },
  {
    key: PERMISSIONS.AGENDA_VIEW,
    name: 'Ver agenda e tarefas',
    description: 'Consulta a agenda da unidade, as tarefas e os compromissos.',
    featureKey: 'operations.agenda',
  },
  {
    key: PERMISSIONS.AGENDA_TASKS_CREATE,
    name: 'Criar tarefas',
    description: 'Cria tarefas operacionais, com ou sem vinculo a uma Ordem de Servico.',
    featureKey: 'operations.agenda',
  },
  {
    key: PERMISSIONS.AGENDA_TASKS_MANAGE,
    name: 'Gerenciar tarefas de terceiros',
    description: 'Edita, conclui e cancela tarefas que pertencem a outra pessoa.',
    featureKey: 'operations.agenda',
  },
  {
    key: PERMISSIONS.AGENDA_TASKS_ASSIGN,
    name: 'Atribuir tarefas',
    description: 'Define o responsavel por uma tarefa, colocando trabalho na fila de alguem.',
    featureKey: 'operations.agenda',
  },
  {
    key: PERMISSIONS.AGENDA_APPOINTMENTS_MANAGE,
    name: 'Gerenciar compromissos',
    description: 'Cria, reagenda e cancela compromissos na agenda da unidade.',
    featureKey: 'operations.agenda',
  },
  {
    key: PERMISSIONS.WORK_CENTER_VIEW,
    name: 'Ver a Central de Trabalho',
    description:
      'Abre a visao operacional com as filas de Ordens de Servico e os sinais de atencao da unidade.',
    featureKey: 'operations.work_center',
  },
  {
    key: PERMISSIONS.COMMUNICATIONS_VIEW,
    name: 'Ver comunicacoes',
    description:
      'Consulta o historico de mensagens enviadas ao cliente e o resultado de cada tentativa.',
    featureKey: 'communications.core',
  },
  {
    key: PERMISSIONS.COMMUNICATIONS_SEND,
    name: 'Enviar mensagens ao cliente',
    description: 'Envia, reenvia e cancela mensagens para o cliente pelos canais disponiveis.',
    featureKey: 'communications.core',
  },
  {
    key: PERMISSIONS.COMMUNICATIONS_TEMPLATES_MANAGE,
    name: 'Gerenciar modelos de mensagem',
    description:
      'Cria, edita e arquiva os modelos de texto que a empresa usa para falar com o cliente.',
    featureKey: 'communications.core',
  },
  {
    key: PERMISSIONS.ANALYTICS_VIEW,
    name: 'Ver o Painel',
    description:
      'Abre o Painel (indicadores e graficos). Cada cartao dentro dele continua exigindo a permissao do dominio de origem.',
    featureKey: 'analytics.dashboard',
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
    key: 'orcamentos',
    name: 'Orcamentos',
    description: 'Propostas comerciais das Ordens de Servico.',
    permissions: [
      PERMISSIONS.QUOTES_VIEW,
      PERMISSIONS.QUOTES_CREATE,
      PERMISSIONS.QUOTES_UPDATE_DRAFT,
      PERMISSIONS.QUOTES_SEND,
      PERMISSIONS.QUOTES_APPROVE,
      PERMISSIONS.QUOTES_REJECT,
      PERMISSIONS.QUOTES_CANCEL,
    ],
  },
  {
    key: 'estoque',
    name: 'Estoque e pecas',
    description: 'Catalogo, saldos, movimentacoes, reservas e transferencias.',
    permissions: [
      PERMISSIONS.INVENTORY_VIEW,
      PERMISSIONS.INVENTORY_CATALOG_MANAGE,
      PERMISSIONS.INVENTORY_LOCATIONS_MANAGE,
      PERMISSIONS.INVENTORY_RECEIVE,
      PERMISSIONS.INVENTORY_ISSUE,
      PERMISSIONS.INVENTORY_RESERVE,
      PERMISSIONS.INVENTORY_TRANSFER,
      PERMISSIONS.INVENTORY_ADJUST,
    ],
  },
  {
    key: 'compras',
    name: 'Fornecedores e compras',
    description: 'Cadastro de fornecedores, necessidades, pedidos e recebimentos.',
    permissions: [
      PERMISSIONS.SUPPLIERS_VIEW,
      PERMISSIONS.SUPPLIERS_MANAGE,
      PERMISSIONS.PURCHASES_VIEW,
      PERMISSIONS.PURCHASES_CREATE,
      PERMISSIONS.PURCHASES_UPDATE,
      PERMISSIONS.PURCHASES_APPROVE,
      PERMISSIONS.PURCHASES_RECEIVE,
      PERMISSIONS.PURCHASES_CANCEL,
    ],
  },
  {
    key: 'financeiro',
    name: 'Financeiro',
    description: 'Contas a receber e a pagar, recebimentos, pagamentos, caixa e configuracao.',
    permissions: [
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_RECEIVABLES_MANAGE,
      PERMISSIONS.FINANCE_PAYABLES_MANAGE,
      PERMISSIONS.FINANCE_RECEIVE,
      PERMISSIONS.FINANCE_PAY,
      PERMISSIONS.FINANCE_REVERSE,
      PERMISSIONS.FINANCE_CASH_OPEN,
      PERMISSIONS.FINANCE_CASH_CLOSE,
      PERMISSIONS.FINANCE_CASH_ADJUST,
      PERMISSIONS.FINANCE_SETTINGS_MANAGE,
    ],
  },
  {
    key: 'garantias',
    name: 'Garantias',
    description:
      'Politicas, emissao, certificados, retornos em garantia, reclassificacao e custos.',
    permissions: [
      PERMISSIONS.WARRANTIES_VIEW,
      PERMISSIONS.WARRANTIES_CREATE,
      PERMISSIONS.WARRANTIES_ISSUE,
      PERMISSIONS.WARRANTIES_RETURN_CREATE,
      PERMISSIONS.WARRANTIES_RECLASSIFY,
      PERMISSIONS.WARRANTIES_CANCEL,
      PERMISSIONS.WARRANTIES_REVOKE,
      PERMISSIONS.WARRANTIES_COSTS_VIEW,
      PERMISSIONS.WARRANTIES_COSTS_MANAGE,
      PERMISSIONS.WARRANTIES_SETTINGS_MANAGE,
    ],
  },
  {
    key: 'agenda',
    name: 'Agenda e Tarefas',
    description: 'Tarefas operacionais, atribuicao, compromissos e a visao de agenda da unidade.',
    permissions: [
      PERMISSIONS.AGENDA_VIEW,
      PERMISSIONS.AGENDA_TASKS_CREATE,
      PERMISSIONS.AGENDA_TASKS_MANAGE,
      PERMISSIONS.AGENDA_TASKS_ASSIGN,
      PERMISSIONS.AGENDA_APPOINTMENTS_MANAGE,
      PERMISSIONS.WORK_CENTER_VIEW,
    ],
  },
  {
    key: 'comunicacao',
    name: 'Comunicacao com o cliente',
    description: 'Envio de mensagens ao cliente, historico de tentativas e modelos de texto.',
    permissions: [
      PERMISSIONS.COMMUNICATIONS_VIEW,
      PERMISSIONS.COMMUNICATIONS_SEND,
      PERMISSIONS.COMMUNICATIONS_TEMPLATES_MANAGE,
    ],
  },
  {
    key: 'plataforma',
    name: 'Modulos e auditoria',
    description: 'Configuracao de funcionalidades e trilha de auditoria.',
    permissions: [PERMISSIONS.FEATURES_VIEW, PERMISSIONS.FEATURES_MANAGE, PERMISSIONS.AUDIT_VIEW],
  },
  {
    key: 'painel',
    name: 'Painel',
    description: 'Indicadores e graficos agregados dos modulos operacionais.',
    permissions: [PERMISSIONS.ANALYTICS_VIEW],
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
/*
 * NOTA sobre Financeiro (Prompt 12): `finance.*` tambem NAO entra nesta lista,
 * pela mesma definicao. Estornar uma liquidacao e das acoes mais sensiveis do
 * sistema — mas nao amplia o acesso de ninguem. Sao permissoes de DINHEIRO e
 * de DADO COMERCIAL, o que e uma preocupacao real e diferente, tratada pelo
 * RBAC, pela auditoria e pelo ledger append-only.
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

/**
 * NOTA — por que `warranties.*` nao esta em HIGH_RISK_PERMISSIONS.
 *
 * `warranties.reclassify` e `warranties.revoke` tem impacto comercial real:
 * uma tira o conserto gratuito do cliente, a outra encerra uma cobertura
 * vigente. Ainda assim o estrago delas e RASTREAVEL — as duas exigem motivo
 * escrito, ficam na linha do tempo da garantia, na auditoria e no outbox, e
 * aparecem na ficha para qualquer pessoa que abra.
 *
 * A lista de alto risco guarda outra coisa: permissoes cujo estrago e
 * IRREVERSIVEL E SILENCIOSO, como conceder acesso administrativo. Uma
 * reclassificacao indevida se descobre lendo a OS; um perfil concedido por
 * engano, nao.
 */
export function isHighRisk(permission: string): boolean {
  return (HIGH_RISK_PERMISSIONS as readonly string[]).includes(permission);
}
