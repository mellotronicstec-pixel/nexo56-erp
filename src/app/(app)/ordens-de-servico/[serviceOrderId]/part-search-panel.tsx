'use client';

import { useState, useTransition } from 'react';
import { Alert, Badge, Button, FormField, Input, Modal, Spinner } from '@/design-system/components';
import {
  createPurchaseNeedFromSelectionAction,
  performPartSearchAction,
  selectPartCandidateAction,
  type PartSearchActionInput,
} from '@/app/(app)/pecas/actions';
import type {
  PerformPartSearchResult,
  PerformPartSearchResultCandidate,
} from '@/modules/part-search/application/search-service';

/**
 * "BUSCAR PECA" — painel da OS (Prompt 21, itens 80 a 96, 147 a 163;
 * label sem "(IA)" desde a correcao de modularidade pos-CI #33: a busca e
 * deterministica, independente do Nexo56 AI — ver `FEATURES.OPERATIONS_PART_SEARCH`).
 *
 * ACAO/FERRAMENTA, nunca status (item 80): disponivel em QUALQUER situacao
 * da OS. NAO deve ser confundida com "Registrar busca de peca" (o
 * `PartPickupPanel` acima, que cria uma TAREFA manual de retirada e so
 * aparece em Aguardando Peca — os dois NAO SAO A MESMA COISA,
 * deliberadamente: aqui e busca tecnica de candidatos com classificacao de
 * compatibilidade; aquele e "lembrete para ir buscar a peca que ja se sabe
 * qual e").
 *
 * Selecionar um resultado NUNCA compra nem reserva nada (item 95/146) — so
 * registra a escolha. Criar necessidade de compra e um segundo passo
 * explicito, com dialogo de confirmacao proprio, e so aparece quando o
 * resultado corresponde a uma peca real do catalogo.
 */

const LABEL_TONE: Record<string, 'success' | 'brand' | 'neutral' | 'warning' | 'danger'> = {
  confirmada: 'success',
  alta_probabilidade: 'brand',
  provavel: 'neutral',
  nao_verificada: 'warning',
  incompativel: 'danger',
};

const LABEL_TEXT: Record<string, string> = {
  confirmada: 'Confirmada',
  alta_probabilidade: 'Alta Probabilidade',
  provavel: 'Provável',
  nao_verificada: 'Não Verificada',
  incompativel: 'Incompatível',
};

const AVAILABILITY_TEXT: Record<string, string> = {
  in_stock: 'Em estoque',
  available: 'Disponível na fonte',
  unavailable: 'Indisponível',
  unknown: 'Não informado',
};

function formatMoney(value: string | null): string {
  if (!value) return 'Não informado';
  const amount = Number(value);
  if (Number.isNaN(amount)) return 'Não informado';
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function CandidateCard({
  candidate,
  onSelect,
  selecting,
}: {
  candidate: PerformPartSearchResultCandidate;
  onSelect: (offerId?: string) => void;
  selecting: boolean;
}) {
  const blocked = candidate.compatibilityLabel === 'incompativel';

  return (
    <div className="rounded-md border border-ink-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink-900">{candidate.title}</p>
          <p className="text-small text-ink-500">
            {candidate.partNumber ? `Referência ${candidate.partNumber}` : 'Sem código informado'}
            {candidate.brand ? ` · ${candidate.brand}` : ''}
            {' · '}
            {candidate.sourceType === 'internal_inventory'
              ? 'No seu estoque'
              : candidate.sourceType === 'purchase_history'
                ? 'Histórico de compra'
                : 'Resultado externo'}
          </p>
        </div>
        <Badge tone={LABEL_TONE[candidate.compatibilityLabel] ?? 'neutral'}>
          {LABEL_TEXT[candidate.compatibilityLabel] ?? candidate.compatibilityLabel}
        </Badge>
      </div>

      {candidate.evidenceSummary.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-small text-ink-600">
          {candidate.evidenceSummary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-small text-ink-500">
          Nenhuma evidência de compatibilidade encontrada.
        </p>
      )}

      {candidate.offers.length > 0 ? (
        <ul className="mt-3 divide-y divide-ink-100 border-t border-ink-100">
          {candidate.offers.map((offer) => (
            <li key={offer.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="text-small text-ink-700">
                <span className="font-medium">
                  {offer.isHistorical ? 'Última compra registrada: ' : ''}
                  {formatMoney(
                    offer.priceCents !== null ? (Number(offer.priceCents) / 100).toFixed(2) : null,
                  )}
                </span>
                {offer.sellerName ? ` · ${offer.sellerName}` : ''}
                {' · '}
                {AVAILABILITY_TEXT[offer.availability] ?? 'Não informado'}
                {offer.leadTimeDays !== null ? ` · ${offer.leadTimeDays} dia(s)` : ''}
                <span className="block text-small text-ink-500">
                  Consultado em {new Date(offer.observedAt).toLocaleDateString('pt-BR')}
                </span>
              </div>
              {!blocked ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={selecting}
                  onClick={() => onSelect(offer.id)}
                >
                  Selecionar esta oferta
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        {blocked ? (
          <p className="text-small text-danger-700">
            Marcado como incompatível — não pode ser selecionado.
          </p>
        ) : (
          <Button variant="ghost" size="sm" disabled={selecting} onClick={() => onSelect()}>
            Selecionar peça (sem oferta específica)
          </Button>
        )}
      </div>
    </div>
  );
}

export function PartSearchPanel({
  serviceOrderId,
  canCreatePurchaseNeed,
}: {
  serviceOrderId: string;
  canCreatePurchaseNeed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PerformPartSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needUnverifiedFor, setNeedUnverifiedFor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [needMessage, setNeedMessage] = useState<string | null>(null);

  function runSearch() {
    if (pending || term.trim().length === 0) return;
    setError(null);
    setResult(null);
    setNeedMessage(null);

    const input: PartSearchActionInput = { term, serviceOrderId, includeExternal: true };
    startTransition(async () => {
      const response = await performPartSearchAction(input);
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setResult(response.result);
    });
  }

  function doSelect(candidate: PerformPartSearchResultCandidate, offerId: string | undefined) {
    if (!result || pending) return;

    if (candidate.compatibilityLabel === 'nao_verificada' && needUnverifiedFor !== candidate.id) {
      setNeedUnverifiedFor(candidate.id);
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await selectPartCandidateAction({
        sessionId: result.sessionId,
        candidateId: candidate.id,
        offerId,
        unverifiedAcknowledged: needUnverifiedFor === candidate.id,
      });
      setNeedUnverifiedFor(null);
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setSelectedId(response.selectionId);
      setNeedMessage(
        canCreatePurchaseNeed && candidate.sourceType === 'internal_inventory'
          ? 'Peça selecionada. Você pode criar uma necessidade de compra abaixo, se precisar.'
          : 'Peça selecionada. Nenhuma compra ou reserva foi feita automaticamente.',
      );
    });
  }

  function createNeed() {
    if (!selectedId || pending) return;
    startTransition(async () => {
      const response = await createPurchaseNeedFromSelectionAction({
        selectionId: selectedId,
        quantity: '1',
      });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setNeedMessage(
        response.reused
          ? 'Já existia uma necessidade de compra em aberto para esta peça — ela foi reaproveitada.'
          : 'Necessidade de compra registrada em Compras.',
      );
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Buscar peça
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Buscar peça"
        description="Resultado encontrado não é peça confirmada — compatibilidade vem antes do preço."
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <FormField label="Termo ou código da peça">
            {(fieldProps) => (
              <div className="flex gap-2">
                <Input
                  {...fieldProps}
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') runSearch();
                  }}
                  placeholder="Ex.: placa fonte, ABC-123"
                />
                <Button onClick={runSearch} disabled={pending || term.trim().length === 0}>
                  {pending ? <Spinner size="sm" /> : 'Buscar'}
                </Button>
              </div>
            )}
          </FormField>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          {result ? (
            <>
              {result.externalOutcome === 'not_configured' ? (
                <Alert tone="warning">
                  Busca externa indisponível neste ambiente. Mostrando apenas resultados internos.
                </Alert>
              ) : null}
              {result.externalOutcome === 'error' || result.externalOutcome === 'timeout' ? (
                <Alert tone="warning">
                  Não foi possível consultar fontes externas agora. Mostrando resultados internos.
                </Alert>
              ) : null}
              {!result.internalSearched ? (
                <Alert tone="info">
                  Você não tem acesso ao Estoque nesta unidade — mostrando apenas fontes externas.
                </Alert>
              ) : null}

              {result.candidates.length === 0 ? (
                <p className="text-ui text-ink-600">
                  Nenhuma peça encontrada para os critérios informados.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {result.candidates.map((candidate) => (
                    <div key={candidate.id}>
                      <CandidateCard
                        candidate={candidate}
                        selecting={pending}
                        onSelect={(offerId) => doSelect(candidate, offerId)}
                      />
                      {needUnverifiedFor === candidate.id ? (
                        <Alert tone="warning">
                          Este resultado ainda não foi verificado.{' '}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => doSelect(candidate, undefined)}
                          >
                            Confirmar seleção mesmo assim
                          </Button>
                        </Alert>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {needMessage ? <Alert tone="success">{needMessage}</Alert> : null}

              {selectedId && canCreatePurchaseNeed ? (
                <Button variant="secondary" onClick={createNeed} disabled={pending}>
                  Criar necessidade de compra
                </Button>
              ) : null}

              <p className="text-small text-ink-500">
                Preço e disponibilidade foram consultados no momento da busca e podem ter mudado.
              </p>
            </>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
