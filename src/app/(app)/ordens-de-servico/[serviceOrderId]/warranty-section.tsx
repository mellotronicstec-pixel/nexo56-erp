'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  Alert,
  Badge,
  Button,
  FormField,
  Input,
  Select,
  Textarea,
} from '@/design-system/components';
import {
  COVERAGE_DESCRIPTION_MAX,
  COVERAGE_KIND_LABEL,
  COVERAGE_KINDS,
  COVERAGE_SUMMARY_MAX,
  DURATION_MAX,
  DURATION_MIN,
  DURATION_UNIT_LABEL,
  DURATION_UNITS,
  EXCLUSIONS_MAX,
  formatWarrantyNumber,
  RECLASSIFY_REASON_MAX,
  RECLASSIFY_REASON_MIN,
  TEMPORAL_CLASS_LABEL,
  warrantyTypeLabel,
  WARRANTY_STATUS_LABEL,
  WARRANTY_STATUS_TONE,
  WARRANTY_TYPE_LABEL,
  WARRANTY_TYPES,
  type DurationUnit,
  type TemporalClass,
  type WarrantyStatus,
} from '@/modules/warranties/domain/warranty';
import { EMPTY_WARRANTY_STATE, type WarrantyActionState } from '../../garantias/action-state';

type ActionFn = (previous: WarrantyActionState, formData: FormData) => Promise<WarrantyActionState>;

export interface WarrantyOnOrder {
  id: string;
  number: number;
  type: string;
  status: string;
  startsOn: string;
  endsOn: string;
  temporal: TemporalClass;
  enforceable: boolean;
}

export interface PolicyOption {
  id: string;
  name: string;
  type: string;
  durationAmount: number;
  durationUnit: string;
}

export interface ReturnOrigin {
  warrantyId: string;
  warrantyNumber: number;
  originalServiceOrderId: string | null;
  originalNumber: number | null;
}

export interface ReturnFromOrder {
  id: string;
  warrantyId: string;
  warrantyNumber: number;
  returnServiceOrderId: string;
  returnNumber: number | null;
  coverageAssessment: string;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

function dataCivil(value: string): string {
  const [ano, mes, dia] = value.split('-');
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : value;
}

/**
 * Emitir a garantia interna a partir da Ordem de Servico (Prompt 13, itens 10,
 * 11 e 74).
 *
 * EMITIR E UM ATO HUMANO, e a OS precisa estar CONCLUIDA. Nao e burocracia: a
 * garantia interna comeca quando o cliente leva o aparelho, e "concluida" e
 * exatamente o estado em que o fluxo registra que ele retirou. Emitir na
 * aprovacao do orcamento faria a contagem comecar numa terca em que o aparelho
 * ainda estava na bancada — e o cliente perderia dias de cobertura que pagou.
 *
 * PAGAMENTO NAO EMITE GARANTIA (ADR-063). O cliente paga por PIX na terca e
 * retira na sexta; a garantia nao pode ter comecado na terca.
 *
 * A COBERTURA E LISTADA, nao resumida num "sim". O formulario oferece linhas
 * de cobertura porque o caso comum e cobrir o reparo da fonte e nao a placa —
 * e um booleano transformaria o retorno pela placa em garantia aceita.
 */
function IssueWarrantyForm({
  serviceOrderId,
  equipmentId,
  policies,
  action,
}: {
  serviceOrderId: string;
  equipmentId: string;
  policies: PolicyOption[];
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_WARRANTY_STATE);

  /** Uma chave por montagem: duplo clique reencontra, nao duplica (item 56). */
  const [commandKey] = useState(() => globalThis.crypto.randomUUID());
  const [parcial, setParcial] = useState(false);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <input type="hidden" name="commandKey" value={commandKey} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      {policies.length > 0 ? (
        <FormField
          label="Politica"
          hint="Preenche o padrao da casa. Os termos sao COPIADOS agora — mudar a politica depois nao mexe nesta garantia."
        >
          {(field) => (
            <Select {...field} name="policyId" defaultValue="">
              <option value="">Sem politica (preencher a mao)</option>
              {policies.map((politica) => (
                <option key={politica.id} value={politica.id}>
                  {politica.name} — {politica.durationAmount}{' '}
                  {DURATION_UNIT_LABEL[politica.durationUnit as DurationUnit] ??
                    politica.durationUnit}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Tipo" required>
          {(field) => (
            <Select {...field} name="type" required defaultValue="internal">
              {WARRANTY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {WARRANTY_TYPE_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="Duracao" hint="Vazio usa a politica escolhida.">
          {(field) => (
            <Input
              {...field}
              name="durationAmount"
              type="number"
              inputMode="numeric"
              min={DURATION_MIN}
              max={DURATION_MAX}
            />
          )}
        </FormField>

        <FormField label="Unidade de prazo">
          {(field) => (
            <Select {...field} name="durationUnit" defaultValue="">
              <option value="">Usar a da politica</option>
              {DURATION_UNITS.map((value) => (
                <option key={value} value={value}>
                  {DURATION_UNIT_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-ui font-medium text-ink-700">Abrangencia</legend>
        <label className="flex items-start gap-2 text-ui text-ink-700">
          <input
            type="radio"
            name="coversWholeService"
            value="whole"
            defaultChecked
            onChange={() => setParcial(false)}
            className="mt-1 size-4 border-ink-300 text-brand-600"
          />
          <span>
            Cobre o servico inteiro
            <span className="block text-small text-ink-500">
              Tudo que foi feito nesta OS, exceto as exclusoes.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-ui text-ink-700">
          <input
            type="radio"
            name="coversWholeService"
            value="partial"
            onChange={() => setParcial(true)}
            className="mt-1 size-4 border-ink-300 text-brand-600"
          />
          <span>
            Cobre apenas os itens listados
            <span className="block text-small text-ink-500">
              O caso comum: garantimos o reparo da fonte, nao a placa.
            </span>
          </span>
        </label>
      </fieldset>

      {parcial ? (
        <Alert tone="warning">
          Liste abaixo exatamente o que esta coberto. Um defeito fora da lista nao gera conserto
          gratuito, mesmo dentro do prazo — e e essa lista que o atendente vai ler no balcao.
        </Alert>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="text-ui font-medium text-ink-700">Itens de cobertura</legend>
        {[0, 1, 2].map((linha) => (
          <div key={linha} className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <Select
              name="coverageKind"
              defaultValue="labor"
              aria-label={`Tipo do item de cobertura ${linha + 1}`}
            >
              {COVERAGE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {COVERAGE_KIND_LABEL[value]}
                </option>
              ))}
            </Select>
            <Input
              name="coverageDescription"
              maxLength={COVERAGE_DESCRIPTION_MAX}
              placeholder={linha === 0 ? 'Reparo da fonte de alimentacao' : 'Outro item (opcional)'}
              aria-label={`Descricao do item de cobertura ${linha + 1}`}
            />
          </div>
        ))}
        <p className="text-small text-ink-500">
          Linhas em branco sao descartadas. Deixe todas vazias para usar so o resumo.
        </p>
      </fieldset>

      <FormField label="Resumo da cobertura" hint="Vazio usa o texto da politica.">
        {(field) => (
          <Textarea {...field} name="coverageSummary" rows={2} maxLength={COVERAGE_SUMMARY_MAX} />
        )}
      </FormField>

      <FormField label="Exclusoes" hint="Vazio usa o texto da politica.">
        {(field) => <Textarea {...field} name="exclusions" rows={2} maxLength={EXCLUSIONS_MAX} />}
      </FormField>

      <p className="text-small text-ink-500">
        A vigencia comeca hoje, na data civil da empresa, e o ultimo dia conta inteiro. Nenhuma
        mensagem e enviada ao cliente: entregar o certificado continua sendo ato humano.
      </p>

      <div className="flex justify-end">
        <SubmitButton>Emitir garantia</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Reclassificar a OS de garantia (itens 32 e 89).
 *
 * PASSA PELA MAQUINA DE ESTADOS, com permissao propria e motivo obrigatorio.
 * Nao existe atalho que escreva `status` direto: reclassificar e o ato de
 * dizer "abrimos como garantia e estavamos errados", e quem ler a OS daqui a
 * seis meses precisa achar a justificativa escrita.
 */
function ReclassifyForm({
  serviceOrderId,
  warrantyId,
  expectedVersion,
  action,
}: {
  serviceOrderId: string;
  warrantyId: string;
  expectedVersion: number;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_WARRANTY_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      <input type="hidden" name="warrantyId" value={warrantyId} />
      <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <FormField
        label="Por que esta OS nao e garantia"
        required
        hint={`Minimo de ${RECLASSIFY_REASON_MIN} caracteres. Fica no historico da OS e da garantia.`}
      >
        {(field) => (
          <Textarea
            {...field}
            name="reason"
            rows={3}
            required
            minLength={RECLASSIFY_REASON_MIN}
            maxLength={RECLASSIFY_REASON_MAX}
          />
        )}
      </FormField>

      <p className="text-small text-ink-500">
        A OS volta para Aguardando Parecer Tecnico e segue o caminho comercial — orcamento,
        aprovacao, conserto. O cliente precisa ser avisado por uma pessoa.
      </p>

      <div className="flex justify-end">
        <SubmitButton>Reclassificar</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Secao de Garantias na ficha da Ordem de Servico (itens 74 e 89).
 *
 * Responde tres perguntas diferentes, e por isso tem tres blocos: esta OS
 * NASCEU de uma garantia? esta OS GEROU garantia? desta OS SAIU algum retorno?
 * Juntar tudo numa lista so faria o atendente confundir a OS original com a
 * OS de garantia — que e exatamente a confusao que este modulo existe para
 * evitar.
 */
export function WarrantySection({
  serviceOrderId,
  equipmentId,
  version,
  classification,
  origin,
  warranties,
  returnsFromThisOrder,
  policies,
  canIssue,
  canReclassify,
  canIssueHere,
  issueBlockedReason,
  issueAction,
  reclassifyAction,
}: {
  serviceOrderId: string;
  equipmentId: string;
  version: number;
  classification: string;
  origin: ReturnOrigin | null;
  warranties: WarrantyOnOrder[];
  returnsFromThisOrder: ReturnFromOrder[];
  policies: PolicyOption[];
  canIssue: boolean;
  canReclassify: boolean;
  canIssueHere: boolean;
  issueBlockedReason: string | null;
  issueAction: ActionFn;
  reclassifyAction: ActionFn;
}) {
  const ehGarantia = classification === 'warranty_internal';

  return (
    <div className="space-y-6">
      {ehGarantia && origin ? (
        <div className="space-y-3">
          <Alert tone="info">
            Esta e uma Ordem de Servico de GARANTIA. Ela nasceu do retorno da garantia{' '}
            <Link
              href={`/garantias/${origin.warrantyId}`}
              className="font-semibold text-brand-700 underline"
            >
              {formatWarrantyNumber(origin.warrantyNumber)}
            </Link>
            {origin.originalServiceOrderId && origin.originalNumber !== null ? (
              <>
                , referente a{' '}
                <Link
                  href={`/ordens-de-servico/${origin.originalServiceOrderId}`}
                  className="font-semibold text-brand-700 underline"
                >
                  OS {origin.originalNumber}
                </Link>
              </>
            ) : null}
            . A OS original NAO foi reaberta e o numero dela nao foi reaproveitado — esta aqui e uma
            ordem nova, com historico proprio.
          </Alert>

          {canReclassify ? (
            <details className="rounded-md border border-ink-200 p-3">
              <summary className="touch-target inline-flex cursor-pointer items-center text-ui font-semibold text-brand-600">
                O defeito nao esta coberto: reclassificar
              </summary>
              <div className="mt-3">
                <ReclassifyForm
                  serviceOrderId={serviceOrderId}
                  warrantyId={origin.warrantyId}
                  expectedVersion={version}
                  action={reclassifyAction}
                />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-ui font-semibold text-ink-900">Garantias emitidas nesta OS</h3>
        {warranties.length === 0 ? (
          <p className="text-ui text-ink-500">Nenhuma garantia emitida a partir desta OS.</p>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
            {warranties.map((garantia) => (
              <li
                key={garantia.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <Link
                    href={`/garantias/${garantia.id}`}
                    className="touch-target inline-flex items-center font-medium text-brand-600"
                  >
                    {formatWarrantyNumber(garantia.number)}
                  </Link>
                  <p className="text-small text-ink-500">
                    {warrantyTypeLabel(garantia.type)} · {dataCivil(garantia.startsOn)} a{' '}
                    {dataCivil(garantia.endsOn)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <Badge
                    tone={WARRANTY_STATUS_TONE[garantia.status as WarrantyStatus] ?? 'neutral'}
                  >
                    {WARRANTY_STATUS_LABEL[garantia.status as WarrantyStatus] ?? garantia.status}
                  </Badge>
                  <Badge tone={garantia.enforceable ? 'success' : 'neutral'}>
                    {TEMPORAL_CLASS_LABEL[garantia.temporal]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {returnsFromThisOrder.length > 0 ? (
        <div>
          <h3 className="mb-2 text-ui font-semibold text-ink-900">Retornos originados desta OS</h3>
          <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
            {returnsFromThisOrder.map((retorno) => (
              <li key={retorno.id} className="flex flex-wrap gap-2 px-3 py-2">
                <Link
                  href={`/garantias/${retorno.warrantyId}`}
                  className="touch-target inline-flex items-center font-medium text-brand-600"
                >
                  {formatWarrantyNumber(retorno.warrantyNumber)}
                </Link>
                {retorno.returnNumber !== null ? (
                  <Link
                    href={`/ordens-de-servico/${retorno.returnServiceOrderId}`}
                    className="touch-target inline-flex items-center text-ui font-semibold text-brand-600"
                  >
                    OS de garantia {retorno.returnNumber}
                  </Link>
                ) : (
                  <span className="text-ui text-ink-500">Sem OS de garantia</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canIssue ? (
        <div>
          <h3 className="mb-2 text-ui font-semibold text-ink-900">Emitir garantia</h3>
          {canIssueHere ? (
            <IssueWarrantyForm
              serviceOrderId={serviceOrderId}
              equipmentId={equipmentId}
              policies={policies}
              action={issueAction}
            />
          ) : (
            <Alert tone="info">
              {issueBlockedReason ??
                'A garantia interna so pode ser emitida depois que a Ordem de Servico for concluida.'}
            </Alert>
          )}
        </div>
      ) : null}
    </div>
  );
}
