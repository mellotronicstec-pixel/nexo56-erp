import {
  normalizeCompactCode,
  normalizeSearchable as normalizeSearchableText,
} from '@/core/text/normalize';

/**
 * Dominio de Equipamentos (Prompt 06, itens 4 a 14).
 *
 * O EQUIPAMENTO E DO TENANT E DO CLIENTE — NUNCA DA UNIDADE (item 5).
 *
 * O mesmo aparelho pode ser levado a lojas diferentes da mesma empresa em
 * momentos diferentes. Quem pertence a uma unidade e o RECEBIMENTO, que e um
 * acontecimento com lugar e hora (item 6).
 *
 * EQUIPAMENTO != RECEBIMENTO (item 8): o equipamento e o objeto fisico que
 * atravessa varios atendimentos; o recebimento e uma entrada especifica dele
 * na assistencia. Um televisor que volta tres vezes tem um equipamento e tres
 * recebimentos — e nenhum deles sobrescreve o anterior.
 */

/**
 * Tensao (item 14).
 *
 * Nao e booleano: "bivolt" nao e "110 ou 220", e um aparelho que aceita as
 * duas; "nao identificada" nao e "nao se aplica". Reduzir isso a um sim/nao
 * perderia justamente a informacao que evita queimar o aparelho do cliente.
 */
export const VOLTAGES = ['v110', 'v127', 'v220', 'bivolt', 'not_applicable', 'unknown'] as const;
export type Voltage = (typeof VOLTAGES)[number];

export const VOLTAGE_LABEL: Record<Voltage, string> = {
  v110: '110 V',
  v127: '127 V',
  v220: '220 V',
  bivolt: 'Bivolt',
  not_applicable: 'Nao se aplica',
  unknown: 'Nao identificada',
};

/** Situacao do cadastro. Nunca exclusao fisica: ha historico atrelado. */
export const EQUIPMENT_STATUSES = ['active', 'inactive'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = {
  active: 'Ativo',
  inactive: 'Inativo',
};

/**
 * Tipos sugeridos (item 10).
 *
 * SUGESTOES, nao taxonomia fechada. O campo persiste texto livre normalizado:
 * uma lista fechada obrigaria a criar migration toda vez que uma assistencia
 * receber algo que ninguem previu — e sempre recebe. As sugestoes existem para
 * que "TV" nao vire "tv", "Televisao" e "Televisor" no mesmo tenant.
 */
export const SUGGESTED_EQUIPMENT_KINDS = [
  'TV',
  'Caixa de som',
  'Amplificador',
  'Receiver',
  'Micro-ondas',
  'Eletrodomestico',
  'Eletronico',
  'Ferramenta',
  'Outro',
] as const;

/** Cabo de forca entregue no recebimento (item 15). */
export const POWER_CABLE_ANSWERS = ['yes', 'no', 'not_applicable'] as const;
export type PowerCableAnswer = (typeof POWER_CABLE_ANSWERS)[number];

export const POWER_CABLE_LABEL: Record<PowerCableAnswer, string> = {
  yes: 'Sim, entregue',
  no: 'Nao entregue',
  not_applicable: 'Nao se aplica',
};

/**
 * Condicoes fisicas de entrada (itens 18 a 20).
 *
 * Registram COMO O APARELHO CHEGOU — nao o que ele tem de defeito. "Carcaca
 * trincada" e estado de entrada; "placa principal queimada" e diagnostico, e
 * diagnostico pertence a Ordem de Servico (item 20). Misturar os dois faria o
 * atendente do balcao emitir parecer tecnico sem abrir o aparelho.
 */
export const INSPECTION_CONDITIONS = [
  { key: 'scratches', label: 'Riscos' },
  { key: 'dents', label: 'Amassados' },
  { key: 'cracks', label: 'Trincas' },
  { key: 'broken_parts', label: 'Partes quebradas' },
  { key: 'missing_screws', label: 'Parafusos ausentes' },
  { key: 'disassembled', label: 'Equipamento desmontado' },
  { key: 'loose_parts', label: 'Pecas soltas' },
  { key: 'oxidation', label: 'Sinais de oxidacao' },
  { key: 'liquid', label: 'Sinais de liquido' },
  { key: 'dirt', label: 'Sujeira excessiva' },
] as const;

export type InspectionConditionKey = (typeof INSPECTION_CONDITIONS)[number]['key'];

const CONDITION_KEYS = new Set<string>(INSPECTION_CONDITIONS.map((item) => item.key));

export function isKnownCondition(key: string): key is InspectionConditionKey {
  return CONDITION_KEYS.has(key);
}

export function conditionLabel(key: string): string {
  return INSPECTION_CONDITIONS.find((item) => item.key === key)?.label ?? key;
}

/**
 * Acessorios sugeridos (item 16).
 *
 * Mesma logica dos tipos: acelera o balcao sem virar limite. O que a lista nao
 * prevê entra como texto livre — e sempre aparece algo que ela nao previu.
 */
export const SUGGESTED_ACCESSORIES = [
  'Controle remoto',
  'Fonte',
  'Carregador',
  'Cabo',
  'Bateria',
  'Tampa',
  'Suporte',
  'Adaptador',
  'Bolsa',
] as const;

/**
 * Tipo de midia (item 22).
 *
 * O SIGNIFICADO da foto e um dado, nao um palpite sobre o nome do arquivo.
 * "IMG_4821.jpg" nao diz se e a etiqueta ou a avaria; a etiqueta precisa ser
 * localizavel depois, porque e a evidencia de identificacao do aparelho.
 */
export const MEDIA_KINDS = [
  'general',
  'front',
  'back',
  'damage',
  'label',
  'serial',
  'accessory',
  'other',
] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  general: 'Visao geral',
  front: 'Frente',
  back: 'Traseira',
  damage: 'Avaria',
  label: 'Etiqueta',
  serial: 'Numero de serie',
  accessory: 'Acessorio',
  other: 'Outro',
};

/**
 * Normalizacao para BUSCA (itens 11, 12 e 13).
 *
 * O valor exibido e sempre preservado como foi digitado. Esta funcao produz
 * apenas a forma de comparacao — e por isso que "Samsung", "SAMSUNG" e
 * "samsung" deixam de virar tres marcas diferentes no mesmo tenant, sem que
 * ninguem perca a grafia que escolheu.
 */
export const normalizeSearchable = normalizeSearchableText;

/**
 * Normalizacao de numero de serie (item 13).
 *
 * Mais agressiva que a de texto: fabricantes imprimem o mesmo serial com
 * hifen, espaco ou nada, e quem digita no balcao copia do jeito que enxerga.
 * Aqui sobram letras e digitos, em maiuscula — o suficiente para "SN: y1-2345"
 * e "Y12345" se encontrarem.
 *
 * NAO ha unicidade global nem por tenant: fabricantes diferentes reutilizam
 * formatos, e dois aparelhos podem legitimamente ter o mesmo codigo curto. O
 * serial repetido vira AVISO de possivel duplicidade (item 55), nunca bloqueio.
 */
export const normalizeSerial = normalizeCompactCode;

/** Nome do equipamento na interface: "Marca Modelo" com o que houver. */
export function equipmentTitle(equipment: {
  kind: string;
  brand: string | null;
  model: string | null;
}): string {
  const parts = [equipment.brand, equipment.model].filter((part): part is string =>
    Boolean(part && part.trim()),
  );
  return parts.length > 0 ? parts.join(' ') : equipment.kind;
}
