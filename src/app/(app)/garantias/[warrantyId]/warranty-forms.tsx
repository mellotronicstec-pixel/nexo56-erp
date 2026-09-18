'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  FormField,
  Input,
  MoneyInput,
  Select,
  Textarea,
  type ButtonVariant,
} from '@/design-system/components';
import {
  COST_DESCRIPTION_MAX,
  COST_KIND_LABEL,
  COST_KINDS,
  COVERAGE_ASSESSMENT_LABEL,
  COVERAGE_ASSESSMENTS,
  RECLASSIFY_REASON_MAX,
  RECLASSIFY_REASON_MIN,
  WARRANTY_REASON_MAX,
  WARRANTY_REASON_MIN,
} from '@/modules/warranties/domain/warranty';
import { EMPTY_WARRANTY_STATE, type WarrantyActionState } from '../action-state';

type ActionFn = (previous: WarrantyActionState, formData: FormData) => Promise<WarrantyActionState>;

function SubmitButton({
  children,
  variant = 'primary',
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

/**
 * Chave de intencao gerada NO CLIENTE, uma por montagem do formulario.
 *
 * E o que transforma "cliquei duas vezes" em "uma coisa so aconteceu": o mesmo
 * formulario reenviado carrega a mesma chave, e o caso de uso reencontra o que
 * ja criou em vez de criar de novo (itens 56 a 58). Recarregar a pagina gera
 * chave nova de proposito — ai a pessoa realmente quis comecar outra vez.
 *
 * A chave NAO AUTORIZA nada e nao substitui a checagem do servidor; ela so
 * identifica a intencao.
 */
function useCommandKey(): string {
  const [key] = useState(() => globalThis.crypto.randomUUID());
  return key;
}

function Feedback({ state }: { state: WarrantyActionState }) {
  return (
    <>
      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
    </>
  );
}

/**
 * Registrar retorno em garantia (Prompt 13, itens 24 a 27 e 88).
 *
 * O FORMULARIO NAO DECIDE NADA. Ele nao diz se a garantia esta valendo, nao
 * escolhe o estado inicial da nova OS e nao decide se cabe conserto gratuito:
 * manda o relato e a avaliacao de cobertura, e o caso de uso recalcula a
 * vigencia contra a data civil de hoje no fuso da empresa antes de agir.
 *
 * A AVALIACAO DE COBERTURA E EXPLICITA, com "Ainda nao sei" como opcao real.
 * Sem ela, o atendente que nao consegue decidir no balcao escolheria "coberto"
 * para nao travar o atendimento — e a loja consertaria de graca por causa de
 * um campo obrigatorio mal desenhado.
 */
export function RegisterReturnForm({
  warrantyId,
  action,
  enforceable,
  impediment,
}: {
  warrantyId: string;
  action: ActionFn;
  enforceable: boolean;
  impediment: string | null;
}) {
  const [state, formAction] = useActionState(action, EMPTY_WARRANTY_STATE);
  const commandKey = useCommandKey();

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="warrantyId" value={warrantyId} />
      <input type="hidden" name="commandKey" value={commandKey} />

      <Feedback state={state} />

      {!enforceable && impediment ? (
        <Alert tone="warning">
          {impediment} O retorno ainda pode ser registrado — e o registro dessa recusa que permite
          explicar ao cliente depois —, mas nao nascera Ordem de Servico de garantia.
        </Alert>
      ) : null}

      <FormField
        label="O que o cliente relatou"
        required
        hint="Nas palavras de quem trouxe o aparelho. O parecer tecnico vem depois, na OS."
      >
        {(field) => (
          <Textarea {...field} name="customerReport" rows={3} required maxLength={2000} />
        )}
      </FormField>

      <FormField
        label="Avaliacao de cobertura"
        required
        hint="O defeito relatado esta dentro do que esta garantia cobre?"
      >
        {(field) => (
          <Select {...field} name="coverageAssessment" defaultValue="undetermined" required>
            {COVERAGE_ASSESSMENTS.map((value) => (
              <option key={value} value={value}>
                {COVERAGE_ASSESSMENT_LABEL[value]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        label="Observacao da avaliacao"
        hint="Por que esta coberto, por que nao esta, ou o que falta para decidir."
      >
        {(field) => <Textarea {...field} name="assessmentNotes" rows={2} maxLength={2000} />}
      </FormField>

      <p className="text-small text-ink-500">
        Se a garantia estiver valendo e o defeito for avaliado como coberto, uma Ordem de Servico
        NOVA sera criada em Aguardando Conserto, vinculada a esta garantia. A OS original nao reabre
        e o numero dela nao e reaproveitado.
      </p>

      <div className="flex justify-end">
        <SubmitButton>Registrar retorno</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Reclassificar a OS de garantia (Prompt 13, itens 32 e 89).
 *
 * ISTO NAO E UM ATALHO PARA MUDAR STATUS. A reclassificacao passa pela mesma
 * maquina de estados de qualquer transicao de OS, com permissao propria e
 * motivo obrigatorio: e o ato de dizer "abrimos como garantia e estavamos
 * errados", e quem le a OS seis meses depois precisa encontrar a justificativa
 * escrita, nao um campo que mudou sozinho.
 */
export function ReclassifyForm({
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
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="serviceOrderId" value={serviceOrderId} />
      <input type="hidden" name="warrantyId" value={warrantyId} />
      <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />

      <Feedback state={state} />

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
        A OS volta para Aguardando Parecer Tecnico e segue o caminho comercial normal — orcamento,
        aprovacao, conserto. O cliente precisa ser avisado por uma pessoa: o Nexo56 nao envia
        mensagem.
      </p>

      <div className="flex justify-end">
        <SubmitButton variant="secondary">Reclassificar</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Cancelar ou revogar (Prompt 13, itens 13 e 62).
 *
 * SAO DOIS ATOS DIFERENTES e por isso sao dois formularios. Cancelar e admitir
 * que a garantia nao deveria ter sido emitida; revogar e dizer que ela deixa
 * de valer de agora em diante, por conduta do cliente ou violacao de termo.
 * Nenhum dos dois apaga retorno ja registrado.
 */
export function LifecycleForm({
  warrantyId,
  kind,
  action,
}: {
  warrantyId: string;
  kind: 'cancel' | 'revoke';
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_WARRANTY_STATE);

  const copy =
    kind === 'cancel'
      ? {
          label: 'Por que esta garantia esta sendo cancelada',
          button: 'Cancelar garantia',
          note: 'Cancelar vale para tras: e a admissao de que a garantia nao deveria existir.',
        }
      : {
          label: 'Por que esta garantia esta sendo revogada',
          button: 'Revogar garantia',
          note: 'Revogar vale de agora em diante. Os retornos ja registrados continuam no historico.',
        };

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="warrantyId" value={warrantyId} />

      <Feedback state={state} />

      <FormField label={copy.label} required hint={`Minimo de ${WARRANTY_REASON_MIN} caracteres.`}>
        {(field) => (
          <Textarea
            {...field}
            name="reason"
            rows={2}
            required
            minLength={WARRANTY_REASON_MIN}
            maxLength={WARRANTY_REASON_MAX}
          />
        )}
      </FormField>

      <p className="text-small text-ink-500">{copy.note}</p>

      <div className="flex justify-end">
        <SubmitButton variant="destructive">{copy.button}</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Registrar custo de garantia (Prompt 13, itens 45 a 47 e 90).
 *
 * ISTO MEDE O GASTO DA LOJA E NAO CRIA LANCAMENTO FINANCEIRO. Nao ha titulo,
 * nao ha movimento no razao e nao ha cobranca: conserto em garantia valida e
 * gratuito para o cliente por definicao, e transformar o custo interno num
 * titulo a receber seria cobrar exatamente quem tem direito a nao pagar.
 */
export function RecordCostForm({
  warrantyId,
  returns,
  action,
}: {
  warrantyId: string;
  returns: Array<{ id: string; label: string }>;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_WARRANTY_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="warrantyId" value={warrantyId} />

      <Feedback state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Tipo de custo" required>
          {(field) => (
            <Select {...field} name="kind" defaultValue="labor" required>
              {COST_KINDS.map((value) => (
                <option key={value} value={value}>
                  {COST_KIND_LABEL[value]}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField label="Valor" required hint="Custo interno da loja, nao preco ao cliente.">
          {(field) => <MoneyInput {...field} name="amount" required />}
        </FormField>
      </div>

      <FormField label="Descricao" required>
        {(field) => (
          <Input {...field} name="description" required maxLength={COST_DESCRIPTION_MAX} />
        )}
      </FormField>

      {returns.length > 0 ? (
        <FormField label="Retorno relacionado" hint="Opcional: liga o custo ao atendimento.">
          {(field) => (
            <Select {...field} name="warrantyReturnId" defaultValue="">
              <option value="">Nao ligar a um retorno</option>
              {returns.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton variant="secondary">Registrar custo</SubmitButton>
      </div>
    </form>
  );
}

/**
 * Gerar o certificado (Prompt 13, itens 18 a 21).
 *
 * O CERTIFICADO E UM SNAPSHOT dos termos da emissao, com soma de verificacao.
 * Gerar de novo NAO reimprime a politica de hoje: devolve exatamente o mesmo
 * documento, com o mesmo token — o QR ja impresso continua valendo.
 */
export function IssueCertificateForm({
  warrantyId,
  existing,
  action,
}: {
  warrantyId: string;
  existing: boolean;
  action: ActionFn;
}) {
  const [state, formAction] = useActionState(action, EMPTY_WARRANTY_STATE);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="warrantyId" value={warrantyId} />
      <Feedback state={state} />
      <SubmitButton variant="secondary">
        {existing ? 'Gerar novamente' : 'Gerar certificado'}
      </SubmitButton>
    </form>
  );
}
