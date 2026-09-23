import { describe, expect, it } from 'vitest';
import {
  externalServiceOrderStatusLabel,
  externalServiceOrderStatusTone,
  isPortalVisibleTimelineEntry,
  maskEquipmentSerial,
  normalizeLoginContact,
  PORTAL_VISIBLE_TIMELINE_KINDS,
} from '@/modules/portal/domain/portal';
import { SERVICE_ORDER_STATUS_LABEL, SERVICE_ORDER_STATUS_TONE } from '@/modules/service-orders/domain/workflow';
import { TIMELINE_KINDS } from '@/modules/service-orders/domain/service-order';

describe('normalizeLoginContact', () => {
  it('reconhece e-mail e normaliza para minusculas', () => {
    expect(normalizeLoginContact('Voce@Exemplo.COM')).toEqual({
      kind: 'email',
      valueNormalized: 'voce@exemplo.com',
    });
  });

  it('reconhece telefone e normaliza para so digitos', () => {
    const resultado = normalizeLoginContact('(11) 99999-8888');
    expect(resultado?.kind).toBe('phone');
    expect(resultado?.valueNormalized).toBe('11999998888');
  });

  it('devolve nulo para texto vazio', () => {
    expect(normalizeLoginContact('   ')).toBeNull();
  });

  it('devolve nulo para telefone invalido', () => {
    expect(normalizeLoginContact('123')).toBeNull();
  });
});

describe('maskEquipmentSerial', () => {
  it('nunca devolve o serial completo', () => {
    const mascarado = maskEquipmentSerial('SN1234567890');
    expect(mascarado).toBe('•••• 7890');
    expect(mascarado).not.toContain('SN12345');
  });

  it('devolve nulo quando nao ha serial', () => {
    expect(maskEquipmentSerial(null)).toBeNull();
    expect(maskEquipmentSerial('')).toBeNull();
  });

  it('mascara por completo serial com 4 caracteres ou menos', () => {
    expect(maskEquipmentSerial('AB12')).toBe('••••');
  });
});

describe('projecao externa de status da OS', () => {
  it('reaproveita o MESMO rotulo do painel interno, nao um segundo mapa', () => {
    for (const status of Object.keys(SERVICE_ORDER_STATUS_LABEL)) {
      expect(externalServiceOrderStatusLabel(status)).toBe(
        SERVICE_ORDER_STATUS_LABEL[status as keyof typeof SERVICE_ORDER_STATUS_LABEL],
      );
      expect(externalServiceOrderStatusTone(status)).toBe(
        SERVICE_ORDER_STATUS_TONE[status as keyof typeof SERVICE_ORDER_STATUS_TONE],
      );
    }
  });

  it('status desconhecido nao quebra: devolve o proprio texto e tom neutro', () => {
    expect(externalServiceOrderStatusLabel('estado_que_nao_existe')).toBe('estado_que_nao_existe');
    expect(externalServiceOrderStatusTone('estado_que_nao_existe')).toBe('neutral');
  });
});

describe('lista de permissao da linha do tempo (item 41 a 44)', () => {
  it('so os tipos explicitamente revisados aparecem ao cliente', () => {
    const esperado = ['created', 'status_changed', 'customer_notification_requested', 'warranty_return_linked'];
    expect([...PORTAL_VISIBLE_TIMELINE_KINDS].sort()).toEqual(esperado.sort());
  });

  it('tipos operacionais internos ficam de fora por padrao', () => {
    const internos = [
      TIMELINE_KINDS.TECHNICIAN_ASSIGNED,
      TIMELINE_KINDS.PART_RESERVED,
      TIMELINE_KINDS.PART_RESERVATION_RELEASED,
      TIMELINE_KINDS.PART_CONSUMED,
      TIMELINE_KINDS.TASK_COMPLETED,
      TIMELINE_KINDS.PART_PICKUP_REQUESTED,
      TIMELINE_KINDS.DETAILS_UPDATED,
      TIMELINE_KINDS.WARRANTY_RECLASSIFIED,
    ];
    for (const kind of internos) {
      expect(isPortalVisibleTimelineEntry(kind)).toBe(false);
    }
  });

  it('um `kind` novo, nao revisado, comeca invisivel (seguro por omissao)', () => {
    expect(isPortalVisibleTimelineEntry('um_tipo_que_ainda_nao_existe')).toBe(false);
  });
});
