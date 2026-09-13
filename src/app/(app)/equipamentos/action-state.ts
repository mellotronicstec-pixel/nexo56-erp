/** Estado das Server Actions de Equipamentos e Recebimento. */
export interface EquipmentActionState {
  error: string | null;
  success: string | null;
  /** Equipamentos parecidos, para AVISAR sem bloquear (item 55). */
  similar: { id: string; title: string; customerName: string }[];
}

export const EMPTY_EQUIPMENT_STATE: EquipmentActionState = {
  error: null,
  success: null,
  similar: [],
};
