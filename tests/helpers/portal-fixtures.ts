import { getDb } from '@/core/db/client';
import { newId } from '@/core/ids/id';
import { createCustomer } from '@/modules/customers/application/customer-service';
import { createEquipment } from '@/modules/equipment/application/equipment-service';
import { createServiceOrder } from '@/modules/service-orders/application/service-order-service';
import { serviceOrderTimeline } from '@/modules/service-orders/infrastructure/schema';
import { warranties, warrantyCertificates } from '@/modules/warranties/infrastructure/schema';
import type { TenantContext } from '@/modules/tenancy/domain/tenant-context';

/**
 * Fixtures do Portal do Cliente.
 *
 * Cliente, equipamento e OS nascem pelos servicos oficiais — e o caminho real
 * de producao. A garantia e o certificado nascem por INSERT direto: o que os
 * testes do Portal verificam e o RECORTE que o Portal expoe, nao a regra de
 * emissao de garantia (ja coberta pela propria suite de Garantias).
 */

export interface PortalScenario {
  customerId: string;
  equipmentId: string;
  serviceOrderId: string;
  serviceOrderNumber: number;
  contactEmail: string;
  contactPhone: string;
}

export async function createPortalScenario(
  context: TenantContext,
  options: { emailSuffix: string },
): Promise<PortalScenario> {
  const contactEmail = `cliente.${options.emailSuffix}@exemplo.invalid`;
  const contactPhone = `1199900${options.emailSuffix.replace(/\D/g, '').padStart(4, '0').slice(-4)}`;

  const { customerId } = await createCustomer(context, {
    kind: 'individual',
    name: `Cliente Portal ${options.emailSuffix}`,
    contacts: [
      { type: 'email', value: contactEmail, isWhatsapp: false },
      { type: 'phone', value: contactPhone, isWhatsapp: true },
    ],
  });

  const { equipmentId } = await createEquipment(context, {
    customerId,
    kind: 'Notebook',
    brand: 'MarcaTeste',
    model: 'ModeloX',
    serial: '1234567890AB',
    voltage: 'bivolt',
  });

  const { serviceOrderId, number } = await createServiceOrder(context, {
    equipmentId,
    customerReport: 'Nao liga.',
    internalNotes: 'Nota interna que o Portal nunca pode mostrar.',
  });

  await getDb().insert(serviceOrderTimeline).values({
    id: newId(),
    tenantId: context.tenantId,
    serviceOrderId,
    kind: 'technician_assigned',
    summary: 'Tecnico Fulano designado',
    actorId: context.userId,
    occurredAt: new Date(),
  });

  return {
    customerId,
    equipmentId,
    serviceOrderId,
    serviceOrderNumber: number,
    contactEmail,
    contactPhone,
  };
}

export interface WarrantyFixtureInput {
  tenantId: string;
  customerId: string;
  equipmentId: string;
  unitId: string;
  status?: 'draft' | 'active' | 'cancelled' | 'revoked';
  number: number;
}

export async function insertWarrantyFixture(input: WarrantyFixtureInput): Promise<string> {
  const warrantyId = newId();
  const now = new Date();

  await getDb()
    .insert(warranties)
    .values({
      id: warrantyId,
      tenantId: input.tenantId,
      unitId: input.unitId,
      number: input.number,
      type: 'internal',
      customerId: input.customerId,
      equipmentId: input.equipmentId,
      durationAmount: 90,
      durationUnit: 'days',
      coversWholeService: 1,
      startsOn: '2025-01-01',
      endsOn: '2025-12-31',
      status: input.status ?? 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

  return warrantyId;
}

export async function insertCertificateFixture(input: {
  tenantId: string;
  warrantyId: string;
  token: string;
}): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(warrantyCertificates)
    .values({
      id: newId(),
      tenantId: input.tenantId,
      warrantyId: input.warrantyId,
      token: input.token,
      format: 'html',
      snapshot: JSON.stringify({
        emitidoEm: '2025-01-01',
        empresa: { nome: 'Empresa Teste', unidade: 'Unidade Teste' },
        garantia: {
          numero: '0001',
          tipo: 'internal',
          vigencia: { inicio: '2025-01-01', fim: '2025-12-31' },
          duracao: '90 dias',
          cobreServicoInteiro: true,
        },
        cliente: { nome: 'Cliente Teste' },
        equipamento: { descricao: 'Notebook MarcaTeste ModeloX', marca: 'MarcaTeste', modelo: 'ModeloX' },
        ordemDeServico: null,
        cobertura: [],
        exclusoes: null,
        termos: null,
      }),
      checksum: 'a'.repeat(64),
      issuedAt: now,
      createdAt: now,
      updatedAt: now,
    });
}
