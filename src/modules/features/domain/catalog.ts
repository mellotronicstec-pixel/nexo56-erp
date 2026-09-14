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
