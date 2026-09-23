/**
 * Feature Catalog da fundacao (Prompt 01, item 23).
 *
 * Regra: so entra aqui capacidade que EXISTE de verdade no codigo. Nao ha
 * entrada para modulo futuro (Clientes, OS, Estoque...) — cada um sera
 * declarado no seu proprio prompt, junto com a implementacao.
 */

export const FEATURE_TYPES = ['CORE', 'OPTIONAL', 'PREMIUM', 'BETA', 'INTERNAL'] as const;
export type FeatureType = (typeof FEATURE_TYPES)[number];

export const FEATURES = {
  CORE_AUTH: 'core.auth',
  CORE_TENANCY: 'core.tenancy',
  CORE_USERS: 'core.users',
  CORE_ACCESS_CONTROL: 'core.access_control',
  CORE_FEATURES: 'core.features',
  CORE_AUDIT: 'core.audit',
  CORE_CUSTOMERS: 'core.customers',
  CORE_EQUIPMENT: 'core.equipment',
  CORE_EQUIPMENT_INTAKE: 'core.equipment_intake',
  CORE_SERVICE_ORDERS: 'core.service_orders',
  CORE_QUOTES: 'core.quotes',
  /**
   * Prefixo `operations.` e nao `core.` (Prompt 10, itens 83 e 84).
   *
   * O prefixo nomeia a AREA do produto; `type` decide se o tenant pode
   * desligar. Estoque e a primeira capacidade de negocio genuinamente
   * OPCIONAL: assistencia que compra peca por atendimento nao mantem
   * estoque, e o Orcamento continua inteiro com linha PART manual (item 86).
   * Chamar de `core.inventory` uma feature OPTIONAL faria a constante
   * contradizer o tipo.
   */
  OPERATIONS_INVENTORY: 'operations.inventory',
  /**
   * Compras depende de Estoque, e nunca o contrario (Prompt 11, item 49).
   * Quem compra precisa saber onde a mercadoria vai entrar; quem controla
   * estoque nao precisa de fornecedor nenhum para funcionar.
   */
  OPERATIONS_PURCHASING: 'operations.purchasing',
  /**
   * Financeiro (Prompt 12, itens 55 e 56).
   *
   * Prefixo proprio porque nao e "uma operacao a mais": e um dominio com
   * vocabulario, permissoes e riscos proprios. OPTIONAL de verdade — a
   * assistencia que controla dinheiro em caderno continua usando OS,
   * Orcamento, Estoque e Compras inteiros.
   */
  FINANCE_CORE: 'finance.core',
  OPERATIONS_WARRANTIES: 'operations.warranties',
  OPERATIONS_AGENDA: 'operations.agenda',
  OPERATIONS_WORK_CENTER: 'operations.work_center',
  COMMUNICATIONS_CORE: 'communications.core',
  CUSTOMER_PORTAL: 'customer.portal',
  PLATFORM_MULTI_UNIT: 'platform.multi_unit',
  PLATFORM_LABEL_RECOGNITION: 'platform.label_recognition',
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

export interface FeatureDefinition {
  key: FeatureKey;
  name: string;
  description: string;
  type: FeatureType;
  /** Features que precisam estar ativas para esta funcionar. */
  dependsOn: readonly FeatureKey[];
}

export const FEATURE_CATALOG: readonly FeatureDefinition[] = [
  {
    key: FEATURES.CORE_AUTH,
    name: 'Autenticacao',
    description: 'Login, sessao e encerramento de sessao.',
    type: 'CORE',
    dependsOn: [],
  },
  {
    key: FEATURES.CORE_TENANCY,
    name: 'Empresa e unidades',
    description: 'Estrutura de empresa (tenant) e suas unidades.',
    type: 'CORE',
    dependsOn: [],
  },
  {
    key: FEATURES.CORE_USERS,
    name: 'Usuarios',
    description: 'Cadastro e situacao dos usuarios da empresa.',
    type: 'CORE',
    dependsOn: [FEATURES.CORE_TENANCY],
  },
  {
    key: FEATURES.CORE_ACCESS_CONTROL,
    name: 'Perfis e permissoes',
    description: 'Perfis de acesso, permissoes e vinculo com usuarios.',
    type: 'CORE',
    dependsOn: [FEATURES.CORE_USERS],
  },
  {
    key: FEATURES.CORE_FEATURES,
    name: 'Modulos e funcionalidades',
    description: 'Catalogo de funcionalidades, plano e configuracao da empresa.',
    type: 'CORE',
    dependsOn: [FEATURES.CORE_TENANCY],
  },
  {
    key: FEATURES.CORE_AUDIT,
    name: 'Auditoria',
    description: 'Trilha de auditoria das acoes relevantes.',
    type: 'CORE',
    dependsOn: [FEATURES.CORE_TENANCY],
  },
  {
    key: FEATURES.CORE_CUSTOMERS,
    name: 'Clientes',
    description:
      'Cadastro de clientes da empresa: pessoas fisicas e juridicas, contatos e enderecos.',
    /**
     * CORE, e nao OPTIONAL, por consequencia e nao por importancia: Ordens de
     * Servico, Garantias e Financeiro vao depender de Cliente. Deixar o tenant
     * desligar Clientes seria oferecer um botao que quebra os modulos que
     * vierem depois — e o dado ficaria orfao na tela, nao apagado.
     */
    type: 'CORE',
    dependsOn: [FEATURES.CORE_TENANCY],
  },
  {
    key: FEATURES.CORE_EQUIPMENT,
    name: 'Equipamentos',
    description: 'Cadastro dos aparelhos dos clientes: tipo, marca, modelo, serie e tensao.',
    /**
     * CORE e dependente de Clientes (item 74): um equipamento sem dono nao
     * existe no dominio. Desativar Clientes nao pode apagar equipamento — a
     * dependencia so impede a ATIVACAO incoerente, e o dado permanece.
     */
    type: 'CORE',
    dependsOn: [FEATURES.CORE_CUSTOMERS],
  },
  {
    key: FEATURES.CORE_EQUIPMENT_INTAKE,
    name: 'Recebimento de equipamentos',
    description:
      'Entrada do aparelho na assistencia: acessorios, inspecao fisica, fotos e responsavel.',
    /** Recebe-se o que esta cadastrado: depende de Equipamentos. */
    type: 'CORE',
    dependsOn: [FEATURES.CORE_EQUIPMENT],
  },
  {
    key: FEATURES.CORE_SERVICE_ORDERS,
    name: 'Ordens de Servico',
    description:
      'Abertura, numeracao, vinculos, ficha e historico das Ordens de Servico da unidade.',
    /**
     * CORE (item 67): a Ordem de Servico e a espinha dorsal de uma assistencia
     * tecnica. Uma empresa que desativasse isto nao estaria usando um Nexo56
     * com menos modulos — estaria usando outro produto.
     *
     * Depende de Clientes e Equipamentos (item 68), declarados os dois
     * explicitamente mesmo com a dependencia sendo transitiva: a OS referencia
     * ambos diretamente, e o grafo deve dizer isso sem que ninguem precise
     * deduzir. A unidade nao entra como feature porque nao e opcional — todo
     * tenant tem ao menos uma, e o contexto de unidade e infraestrutura.
     */
    type: 'CORE',
    dependsOn: [FEATURES.CORE_CUSTOMERS, FEATURES.CORE_EQUIPMENT],
  },
  {
    key: FEATURES.CORE_QUOTES,
    name: 'Orcamentos',
    description:
      'Propostas comerciais da Ordem de Servico: itens, valores, envio, aprovacao e recusa.',
    /**
     * CORE, e nao OPTIONAL: numa assistencia tecnica o cliente aprova um preco
     * antes do conserto. Uma empresa que desligasse isto teria Ordens de
     * Servico parando em Aguardando Aprovacao sem meio de sair dali pelo
     * caminho comercial.
     *
     * Depende de Ordens de Servico porque todo orcamento pertence a uma OS
     * (item 76) — nao existe orcamento avulso do tenant.
     */
    type: 'CORE',
    dependsOn: [FEATURES.CORE_SERVICE_ORDERS],
  },
  {
    key: FEATURES.OPERATIONS_INVENTORY,
    name: 'Estoque e pecas',
    description:
      'Catalogo de pecas, localizacoes, saldo por unidade, movimentacoes, reservas e transferencias.',
    /**
     * OPTIONAL de verdade (Prompt 10, itens 84, 86 e 87).
     *
     * Desligar NAO apaga peca, movimentacao nem reserva: impede operacao NOVA
     * e some do menu. O historico continua legivel, o orcamento continua
     * funcionando com linha PART escrita a mao, e a OS antiga permanece
     * integra.
     *
     * Depende de Ordens de Servico porque reserva e consumo se vinculam a uma
     * OS da unidade. NAO depende de Orcamentos, e nao pode depender: o vinculo
     * peca x linha PART e opcional nos dois sentidos, e uma dependencia mutua
     * Quotes <-> Inventory seria um ciclo (item 85).
     */
    type: 'OPTIONAL',
    dependsOn: [FEATURES.CORE_SERVICE_ORDERS],
  },
  {
    key: FEATURES.OPERATIONS_PURCHASING,
    name: 'Fornecedores e compras',
    description:
      'Cadastro de fornecedores, necessidades de compra, pedidos, recebimento parcial e historico de custo.',
    /**
     * OPTIONAL (Prompt 11, item 49). Assistencia que compra no balcao da loja
     * ao lado nao registra pedido: da entrada manual no estoque e pronto.
     *
     * Depende de Estoque porque RECEBER é dar entrada — sem catalogo de pecas
     * e sem saldo, um recebimento nao teria onde chegar. A dependencia e de
     * mao unica: desligar Compras nao afeta Estoque, e o historico de estoque
     * originado por compra continua legivel (item 50).
     */
    type: 'OPTIONAL',
    dependsOn: [FEATURES.OPERATIONS_INVENTORY],
  },
  {
    key: FEATURES.FINANCE_CORE,
    name: 'Financeiro',
    description:
      'Contas a receber e a pagar, parcelamento, recebimentos, pagamentos, caixa, despesas e fluxo financeiro.',
    /**
     * OPTIONAL, e a consequencia disso e deliberada (Prompt 12, item 57):
     * desligar o Financeiro NAO impede uma Ordem de Servico de ser
     * tecnicamente concluida. Conclusao tecnica e fechamento financeiro sao
     * coisas diferentes, e o produto inteiro depende de continuarem sendo.
     *
     * Depende de CLIENTES porque toda cobranca tem um devedor, e o cliente e o
     * unico cadastro que o Financeiro exige para existir. NAO depende de
     * Compras nem de Estoque: uma loja sem pedido de compra ainda paga
     * aluguel, e uma despesa manual nao precisa de peca nenhuma. Quando
     * Compras existe, o Financeiro CONSOME o fato de recebimento — a
     * dependencia e de mao unica, e Compras nunca importa o Financeiro.
     */
    type: 'OPTIONAL',
    dependsOn: [FEATURES.CORE_CUSTOMERS],
  },
  {
    key: FEATURES.OPERATIONS_AGENDA,
    name: 'Agenda e Tarefas',
    description:
      'Tarefas operacionais, compromissos, minhas tarefas e a visao de agenda que reune o trabalho da unidade.',
    /**
     * OPTIONAL — e SEM DEPENDENCIA de Ordens de Servico (Prompt 14, item 71).
     *
     * A pergunta arquitetural foi feita e respondida com o caso real: uma
     * tarefa administrativa — "conferir a documentacao do fornecedor",
     * "organizar a prateleira" — nao tem Ordem de Servico nenhuma, e exigir
     * o modulo de OS para criar essa tarefa seria inventar um acoplamento que
     * a operacao nao tem.
     *
     * A integracao com a OS e CAPACIDADE OPORTUNISTA, nao dependencia: quando
     * a ordem existe, a tarefa pode apontar para ela e a agenda mostra as
     * tarefas de fluxo e os acompanhamentos junto das suas. Quando nao existe,
     * a Agenda continua inteira.
     *
     * NAO depende de Garantias, Estoque, Compras nem Financeiro (itens 72 a
     * 75): os vinculos para esses contextos sao campos opcionais, e desligar
     * qualquer um deles nao tira a Agenda do ar.
     *
     * O CAMINHO INVERSO TAMBEM VALE, e e o mais importante (item 77): desligar
     * a Agenda NAO desliga o acompanhamento da Ordem de Servico. O follow-up
     * de +2 e +3 dias e as tarefas de fluxo vivem no modulo de OS, que e CORE,
     * e continuam funcionando sozinhos — "nenhuma Ordem de Servico importante
     * deve ser esquecida" nao e uma promessa opcional (ADR-075).
     */
    type: 'OPTIONAL',
    dependsOn: [],
  },
  {
    key: FEATURES.OPERATIONS_WORK_CENTER,
    name: 'Central de Trabalho',
    description:
      'Visao operacional unica: filas de Ordens de Servico por estado, sinais de atencao e o caminho direto para o contexto certo.',
    /**
     * OPTIONAL, e dependente APENAS de Ordens de Servico.
     *
     * A dependencia de OS e real, nao burocratica: o conteudo da Central sao
     * as filas de OS. Sem o modulo de Ordens de Servico nao ha o que enfileirar,
     * e a tela existiria vazia para sempre.
     *
     * NAO depende da Agenda (item 20), e esta e a decisao que mais importa
     * aqui. A Central mostra follow-up e tarefa de fluxo lendo o NUCLEO — as
     * colunas da propria OS e `service_order_tasks`, ambos CORE do Prompt 08.
     * O que vem da Agenda (tarefas gerais, compromissos) e camada
     * OPORTUNISTA: some quando `operations.agenda` esta desligada, e o resto
     * da Central continua inteiro. Fazer o contrario transformaria um modulo
     * opcional em pre-requisito da pergunta "o que preciso fazer hoje?".
     *
     * NAO depende de Estoque, Compras, Financeiro nem Garantias: quando
     * disponiveis, a Central pode mostrar sinais desses contextos; quando nao,
     * ela nao os menciona e nao quebra (ADR-077).
     */
    type: 'OPTIONAL',
    dependsOn: [FEATURES.CORE_SERVICE_ORDERS],
  },
  {
    key: FEATURES.OPERATIONS_WARRANTIES,
    name: 'Garantias',
    description:
      'Politicas, garantias interna/fabrica/peca/estendida, certificados, retornos em garantia e custos.',
    /**
     * OPTIONAL, e a consequencia e deliberada (Prompt 13, itens 71 e 73):
     * desligar Garantias NAO impede uma Ordem de Servico de ser aberta,
     * consertada e finalizada. Uma assistencia que nao concede garantia
     * formal — ou que ainda a controla num caderno — continua usando o Nexo56
     * inteiro.
     *
     * Depende de ORDENS DE SERVICO porque a Garantia Interna cobre um reparo,
     * e o reparo mora na OS. NAO depende de Estoque, Compras nem Financeiro:
     * uma garantia de mao de obra existe sem peca, sem compra e sem cobranca —
     * e exigir o Financeiro faria a loja que nao cobrou perder o direito de
     * garantir o proprio servico (item 72).
     */
    type: 'OPTIONAL',
    dependsOn: [FEATURES.CORE_SERVICE_ORDERS],
  },
  {
    key: FEATURES.COMMUNICATIONS_CORE,
    name: 'Comunicacao com o cliente',
    description:
      'Mensagens para o cliente por WhatsApp, e-mail e SMS, com modelos de texto, historico e registro de cada tentativa de entrega.',
    /**
     * OPTIONAL, e a consequencia importa (Prompt 16, itens 68 a 78):
     * desligar Comunicacao NAO impede abrir, consertar, orcar, faturar nem
     * entregar uma Ordem de Servico. A oficina que avisa o cliente pelo
     * telefone pessoal continua usando o Nexo56 inteiro — e esse e o teste de
     * que a comunicacao nao virou autoridade sobre o fato operacional.
     *
     * Depende de CLIENTES porque o destinatario sai do cadastro de contatos.
     * Sem cliente nao ha para quem mandar, e um modulo de comunicacao que
     * digita o telefone a mao toda vez seria um caderno com botao de enviar.
     *
     * NAO depende de ORDENS DE SERVICO (item 73), e esta e a decisao central.
     * A OS e CONTEXTO OPORTUNISTA: quando existe, a mensagem aponta para ela e
     * o texto pode usar o numero e o estado; quando nao existe, a mensagem sai
     * do mesmo jeito. Declarar a dependencia faria o modulo prometer algo que
     * ele nao precisa — e empurraria, na primeira pressa, a comunicacao para
     * dentro do fluxo da ordem.
     *
     * O CAMINHO INVERSO E O QUE MAIS IMPORTA (item 77): com a Comunicacao
     * desligada, `notifyCustomerReady` continua movendo a OS para "aguardando
     * retirada" e registrando na linha do tempo que o cliente foi avisado. O
     * que deixa de acontecer e o envio — nunca a transicao (ADR-078).
     */
    type: 'OPTIONAL',
    dependsOn: [FEATURES.CORE_CUSTOMERS],
  },
  {
    key: FEATURES.CUSTOMER_PORTAL,
    name: 'Portal do cliente',
    description:
      'Area externa onde o cliente acompanha, por conta propria, as ordens de servico, os equipamentos e as garantias do seu cadastro.',
    /**
     * OPTIONAL, com a mesma prova de independencia da Comunicacao (Prompt 17,
     * item 122): desligar o Portal nao muda UMA linha do funcionamento
     * interno. Nenhum service da OS, do Equipamento ou da Garantia importa
     * nada de `modules/portal` — a dependencia e de mao unica, do Portal para
     * dentro, nunca o contrario.
     *
     * Desligar no MEIO de uma sessao ativa (item 122) derruba a sessao no
     * proximo acesso: `getPortalContext` reavalia esta feature a cada
     * requisicao, e nao guarda "estava ligado quando entrou".
     *
     * Depende de CLIENTES e ORDENS DE SERVICO porque e exatamente o que o
     * Portal projeta para fora — sem os dois, nao ha o que mostrar.
     */
    type: 'OPTIONAL',
    dependsOn: [FEATURES.CORE_CUSTOMERS, FEATURES.CORE_SERVICE_ORDERS],
  },
  {
    key: FEATURES.PLATFORM_MULTI_UNIT,
    name: 'Multiunidade',
    description:
      'Operacao com mais de uma unidade/filial: administracao de unidades e troca de unidade pelo usuario.',
    type: 'OPTIONAL',
    dependsOn: [FEATURES.CORE_TENANCY],
  },
  {
    key: FEATURES.PLATFORM_LABEL_RECOGNITION,
    name: 'Leitura automatica de etiqueta',
    description:
      'Preenche a identificacao do equipamento a partir da foto da etiqueta. Depende de provider externo.',
    /**
     * OPTIONAL de verdade (item 71): depende de um provider de OCR/visao que
     * e contratado e cobrado a parte. Todo o modulo de Equipamentos funciona
     * sem ela (item 41) — quando indisponivel, o cadastro e manual e nada
     * mais muda.
     */
    type: 'OPTIONAL',
    dependsOn: [FEATURES.CORE_EQUIPMENT],
  },
];

const BY_KEY = new Map<string, FeatureDefinition>(FEATURE_CATALOG.map((f) => [f.key, f]));

export function findFeature(key: string): FeatureDefinition | undefined {
  return BY_KEY.get(key);
}

/** CORE nao pode ser desativada pelo tenant (Prompt 00, item 12). */
export function isCore(key: string): boolean {
  return BY_KEY.get(key)?.type === 'CORE';
}

/**
 * Deteccao de ciclo no grafo de dependencias (Prompt 01, item 28).
 * Executada nos testes e no seed, antes de qualquer gravacao.
 */
export function findDependencyCycle(
  catalog: readonly FeatureDefinition[] = FEATURE_CATALOG,
): string[] | null {
  const byKey = new Map(catalog.map((f) => [f.key as string, f]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  function visit(key: string): string[] | null {
    const current = state.get(key);
    if (current === 'done') return null;
    if (current === 'visiting') return [...stack.slice(stack.indexOf(key)), key];

    state.set(key, 'visiting');
    stack.push(key);

    for (const dependency of byKey.get(key)?.dependsOn ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }

    stack.pop();
    state.set(key, 'done');
    return null;
  }

  for (const feature of catalog) {
    const cycle = visit(feature.key);
    if (cycle) return cycle;
  }
  return null;
}
