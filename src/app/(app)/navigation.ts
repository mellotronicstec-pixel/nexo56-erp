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
 * item 117): Garantias, Agenda e BI entrarao AQUI, cada um no seu prompt, com
 * a feature e a permissao correspondentes. A estrutura de secoes ja acomoda
 * esse crescimento sem reescrita.
 */

/**
 * Chave do icone, NAO o componente.
 *
 * O menu e montado no servidor (layout) e renderizado no cliente (shell), e a
 * fronteira entre os dois so aceita dados serializaveis — funcao de componente
 * nao atravessa. Entao o servidor manda o nome e o shell resolve o desenho.
 */
export type NavIconKey =
  | 'user'
  | 'users'
  | 'shield'
  | 'building'
  | 'modules'
  | 'history'
  | 'customers'
  | 'equipment'
  | 'intake'
  | 'service-order'
  | 'inventory'
  | 'supplier'
  | 'purchase'
  | 'finance'
  | 'cash-register'
  | 'warranty'
  | 'agenda'
  | 'task'
  | 'work-center';

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
        /**
         * A CENTRAL VEM PRIMEIRO, e e o unico item do menu que nao abre um
         * modulo: ela abre a PERGUNTA "o que precisa da minha atencao agora?".
         * Quem chega de manha comeca por ela e so entra em Clientes, OS ou
         * Estoque depois de saber para onde ir.
         *
         * OPCIONAL e dependente de Ordens de Servico: quando a feature esta
         * desligada o item some e o menu se fecha sozinho, sem buraco.
         */
        href: '/central-de-trabalho',
        label: 'Central de Trabalho',
        featureKey: FEATURES.OPERATIONS_WORK_CENTER,
        permission: PERMISSIONS.WORK_CENTER_VIEW,
        icon: 'work-center',
      },
      {
        href: '/clientes',
        label: 'Clientes',
        featureKey: FEATURES.CORE_CUSTOMERS,
        permission: PERMISSIONS.CUSTOMERS_VIEW,
        icon: 'customers',
      },
      {
        href: '/equipamentos',
        label: 'Equipamentos',
        featureKey: FEATURES.CORE_EQUIPMENT,
        permission: PERMISSIONS.EQUIPMENT_VIEW,
        icon: 'equipment',
      },
      {
        href: '/recebimentos',
        label: 'Recebimentos',
        featureKey: FEATURES.CORE_EQUIPMENT_INTAKE,
        permission: PERMISSIONS.EQUIPMENT_INTAKE_VIEW,
        icon: 'intake',
      },
      {
        href: '/ordens-de-servico',
        label: 'Ordens de Servico',
        featureKey: FEATURES.CORE_SERVICE_ORDERS,
        permission: PERMISSIONS.SERVICE_ORDERS_VIEW,
        icon: 'service-order',
      },
      {
        /**
         * Estoque e OPCIONAL (Prompt 10, itens 84 e 91): o item so aparece se
         * a empresa tiver o modulo ativo E a pessoa tiver `inventory.view`.
         * Quando o modulo esta desligado, ele some — e o Orcamento continua
         * funcionando com linha PART escrita a mao.
         */
        href: '/estoque',
        label: 'Estoque e pecas',
        featureKey: FEATURES.OPERATIONS_INVENTORY,
        permission: PERMISSIONS.INVENTORY_VIEW,
        icon: 'inventory',
      },
      {
        /**
         * Fornecedores e Compras sao OPCIONAIS e dependem de Estoque (Prompt
         * 11, itens 81 e 91). Sao DOIS itens de menu porque sao duas
         * permissoes: quem cuida do cadastro do distribuidor nao e
         * necessariamente quem autoriza a despesa.
         */
        href: '/fornecedores',
        label: 'Fornecedores',
        featureKey: FEATURES.OPERATIONS_PURCHASING,
        permission: PERMISSIONS.SUPPLIERS_VIEW,
        icon: 'supplier',
      },
      {
        href: '/compras',
        label: 'Compras',
        featureKey: FEATURES.OPERATIONS_PURCHASING,
        permission: PERMISSIONS.PURCHASES_VIEW,
        icon: 'purchase',
      },
      {
        /**
         * Garantias e OPCIONAL e depende de Ordens de Servico (Prompt 13,
         * itens 78 e 84). Quando o modulo esta desligado, o item some e a OS
         * continua funcionando exatamente como antes — nenhuma tela de OS
         * depende de garantia existir.
         *
         * Fica em Operacao, e nao em secao propria: garantia e assunto de
         * bancada e de balcao, no mesmo bloco de quem abre e fecha OS. O
         * Financeiro ganhou secao propria porque quem mexe em dinheiro
         * raramente e quem mexe em aparelho; aqui e a mesma gente.
         */
        href: '/garantias',
        label: 'Garantias',
        featureKey: FEATURES.OPERATIONS_WARRANTIES,
        permission: PERMISSIONS.WARRANTIES_VIEW,
        icon: 'warranty',
      },
      {
        /**
         * Agenda e Tarefas e OPCIONAL e NAO depende de Ordens de Servico
         * (Prompt 14, item 71): "conferir a documentacao do fornecedor" e
         * trabalho real sem OS nenhuma.
         *
         * Quando o modulo esta desligado, os tres itens somem — e o
         * acompanhamento da OS continua funcionando exatamente como antes,
         * porque `follow_up_at` e a varredura sao do nucleo e nunca
         * dependeram daqui (ADR-073).
         *
         * SAO TRES ITENS, nao um com abas, porque sao tres perguntas
         * diferentes: "o que tem para esta semana?" (Agenda), "o que eu devo?"
         * (Minhas tarefas) e "o que a unidade tem em aberto?" (Tarefas). A do
         * meio e a que o tecnico abre todo dia, entao ela nao pode estar
         * escondida atras de duas.
         */
        href: '/agenda',
        label: 'Agenda',
        featureKey: FEATURES.OPERATIONS_AGENDA,
        permission: PERMISSIONS.AGENDA_VIEW,
        icon: 'agenda',
      },
      {
        href: '/minhas-tarefas',
        label: 'Minhas tarefas',
        featureKey: FEATURES.OPERATIONS_AGENDA,
        permission: PERMISSIONS.AGENDA_VIEW,
        icon: 'task',
      },
      {
        href: '/tarefas',
        label: 'Tarefas da unidade',
        featureKey: FEATURES.OPERATIONS_AGENDA,
        permission: PERMISSIONS.AGENDA_VIEW,
        icon: 'task',
      },
    ],
  },
  {
    /**
     * O Financeiro tem SECAO PROPRIA, nao um item dentro de Operacao (Prompt
     * 12, item 62).
     *
     * Nao e capricho de organograma: quem mexe em dinheiro raramente e quem
     * mexe em bancada. Separar as secoes deixa o menu honesto para o tecnico
     * que so tem `finance.view` — ele ve o bloco financeiro pequeno e sabe
     * que o resto nao e com ele — e para o financeiro que nao abre OS.
     *
     * Sao DOIS itens porque sao DUAS permissoes: `finance.view` abre as
     * listas; o Caixa exige `finance.cash.open`, que nem todo mundo que
     * consulta um titulo precisa ter.
     */
    title: 'Financeiro',
    items: [
      {
        href: '/financeiro',
        label: 'Financeiro',
        featureKey: FEATURES.FINANCE_CORE,
        permission: PERMISSIONS.FINANCE_VIEW,
        icon: 'finance',
      },
      {
        href: '/financeiro/caixa',
        label: 'Caixa',
        featureKey: FEATURES.FINANCE_CORE,
        permission: PERMISSIONS.FINANCE_CASH_OPEN,
        icon: 'cash-register',
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
  equipamentos: 'Equipamentos',
  recebimentos: 'Recebimentos',
  'ordens-de-servico': 'Ordens de Servico',
  estoque: 'Estoque e pecas',
  'nova-peca': 'Nova peca',
  localizacoes: 'Localizacoes',
  fornecedores: 'Fornecedores',
  'novo-fornecedor': 'Novo fornecedor',
  compras: 'Compras',
  garantias: 'Garantias',
  lista: 'Lista',
  retornos: 'Retornos',
  politicas: 'Politicas de garantia',
  'nova-politica': 'Nova politica',
  'novo-retorno': 'Registrar retorno',
  certificado: 'Certificado',
  necessidades: 'Necessidades de compra',
  'novo-pedido': 'Novo pedido',
  administracao: 'Administracao',
  usuarios: 'Usuarios',
  perfis: 'Perfis de acesso',
  unidades: 'Unidades',
  modulos: 'Modulos e funcionalidades',
  auditoria: 'Auditoria',
  'minha-conta': 'Minha conta',
};
