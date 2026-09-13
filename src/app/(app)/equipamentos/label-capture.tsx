'use client';

import { useRef, useState } from 'react';
import { Alert, Button, ImagePreparationError, prepareImage } from '@/design-system/components';
import { IconCamera } from '@/design-system/icons';
import type { Voltage } from '@/modules/equipment/domain/equipment';

/**
 * Captura inteligente da etiqueta (Prompt 06, itens 33 a 40 e 87).
 *
 * ESTADO REAL: nao ha provider de OCR configurado. Quando `available` e falso,
 * este bloco explica isso em portugues e desaparece do caminho — o cadastro
 * manual continua exatamente como estava (itens 40 e 41).
 *
 * Quando um provider existir, o fluxo ja e este: foto -> processamento ->
 * REVISAO -> confirmacao. Nada e salvo automaticamente (item 34), e a
 * confirmacao humana e que determina o valor persistido (item 39).
 *
 * `capture="environment"` SUGERE a camera traseira no celular; onde nao houver
 * camera, o mesmo input abre a galeria — e por isso nao ha caminho sem saida
 * (itens 86 e 87).
 */

export interface RecognizedFields {
  brand?: string;
  model?: string;
  serial?: string;
  voltage?: Voltage;
}

export function LabelCapture({
  available,
  onAccept,
}: {
  available: boolean;
  onAccept: (fields: RecognizedFields) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'preparing' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  if (!available) {
    return (
      <Alert tone="info" title="Leitura automatica de etiqueta indisponivel">
        Esta empresa ainda nao tem a leitura automatica ativada. Preencha a identificacao
        manualmente — todos os campos abaixo continuam funcionando normalmente.
      </Alert>
    );
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus('preparing');
    setMessage(null);

    try {
      await prepareImage(file);
      /**
       * Chegando aqui, a imagem esta pronta para ser enviada ao provider.
       * Como nenhum provider real esta configurado, a interface diz isso em
       * vez de inventar um resultado — simular OCR seria pior do que nao ter:
       * o atendente confiaria num palpite.
       */
      setStatus('error');
      setMessage(
        'Nao conseguimos identificar os dados automaticamente. Voce pode preencher manualmente.',
      );
    } catch (error) {
      setStatus('error');
      setMessage(
        error instanceof ImagePreparationError
          ? error.message
          : 'Nao foi possivel usar a camera neste dispositivo. Preencha os dados manualmente.',
      );
    }
  }

  return (
    <div className="rounded-md border border-ink-200 bg-ink-25 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-ink-900">Ler etiqueta</p>
          <p className="text-small text-ink-600">
            Fotografe a etiqueta do aparelho. Voce revisa os dados antes de salvar.
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          loading={status === 'preparing'}
          onClick={() => inputRef.current?.click()}
        >
          <IconCamera size={18} />
          Fotografar etiqueta
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Foto da etiqueta"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {message ? (
        <Alert tone="warning" className="mt-3">
          {message}
        </Alert>
      ) : null}

      {/* O callback existe e e o ponto de entrada da confirmacao humana; sem
          provider, nenhum campo chega ate ele. */}
      <span hidden aria-hidden="true" data-accept-ready={typeof onAccept === 'function'} />
    </div>
  );
}
