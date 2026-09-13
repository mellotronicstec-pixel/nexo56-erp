'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  ImagePreparationError,
  prepareImage,
  Select,
  type PreparedImage,
} from '@/design-system/components';
import { IconCamera, IconClose, IconPlus } from '@/design-system/icons';
import { IconButton } from '@/design-system/components';
import { MEDIA_KINDS, MEDIA_KIND_LABEL } from '@/modules/equipment/domain/equipment';
import { EMPTY_EQUIPMENT_STATE, type EquipmentActionState } from '../action-state';

/**
 * Envio de fotos (Prompt 06, itens 23, 24, 92 a 95).
 *
 * DOIS CAMINHOS PARA A MESMA COISA (itens 23 e 87): o botao "Tirar foto" usa
 * `capture="environment"` e sugere a camera traseira; o "Escolher arquivo"
 * abre a galeria ou o disco. Se a camera nao existir ou for negada, o segundo
 * caminho continua inteiro — nunca ha beco sem saida.
 *
 * A imagem e preparada ANTES de subir: reduzida, reexportada como JPEG e, por
 * consequencia disso, sem EXIF. A previa aparece e pode ser descartada antes
 * do envio (item 93).
 */

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? 'Enviando...' : 'Enviar foto'}
    </Button>
  );
}

export function MediaManager({
  uploadAction,
  removeAction,
  equipmentId,
  intakeId,
  media,
}: {
  uploadAction: (
    previous: EquipmentActionState,
    formData: FormData,
  ) => Promise<EquipmentActionState>;
  removeAction: (
    previous: EquipmentActionState,
    formData: FormData,
  ) => Promise<EquipmentActionState>;
  equipmentId: string;
  intakeId?: string | null;
  media: { id: string; kind: string; caption: string | null }[];
}) {
  const [uploadState, uploadFormAction] = useActionState(uploadAction, EMPTY_EQUIPMENT_STATE);
  const [removeState, removeFormAction] = useActionState(removeAction, EMPTY_EQUIPMENT_STATE);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function handleSelection(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    setError(null);

    try {
      const result = await prepareImage(file);
      setPrepared(result);

      /**
       * O arquivo JA PREPARADO e colocado no input que sera enviado. Sem isso,
       * o formulario mandaria a foto original de 12 MP e todo o trabalho de
       * reducao (e a remocao do EXIF junto com ele) seria perdido.
       */
      if (fileRef.current) {
        const transfer = new DataTransfer();
        transfer.items.add(result.file);
        fileRef.current.files = transfer.files;
      }
    } catch (caught) {
      setError(
        caught instanceof ImagePreparationError
          ? caught.message
          : 'Nao foi possivel preparar esta foto. Tente outra imagem.',
      );
    } finally {
      setPreparing(false);
    }
  }

  function discard() {
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="space-y-4">
      {uploadState.error ? <Alert tone="danger">{uploadState.error}</Alert> : null}
      {removeState.error ? <Alert tone="danger">{removeState.error}</Alert> : null}
      {error ? <Alert tone="warning">{error}</Alert> : null}

      <form action={uploadFormAction} className="space-y-3">
        <input type="hidden" name="equipmentId" value={equipmentId} />
        {intakeId ? <input type="hidden" name="intakeId" value={intakeId} /> : null}
        {/*
          Carregador interno: guarda o arquivo JA PREPARADO ate o envio. Nao e
          um controle de interface — quem opera usa os botoes acima. Fica fora
          da ordem de tabulacao (`tabIndex -1`) porque um elemento focavel com
          `aria-hidden` quebra a navegacao por teclado e por leitor de tela
          (WCAG 4.1.2; axe `aria-hidden-focus`).
        */}
        <input
          ref={fileRef}
          type="file"
          name="file"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={preparing}
            onClick={() => cameraRef.current?.click()}
          >
            <IconCamera size={18} />
            Tirar foto
          </Button>
          <Button type="button" variant="secondary" onClick={() => galleryRef.current?.click()}>
            <IconPlus size={18} />
            Escolher arquivo
          </Button>
        </div>

        {/* Camera traseira sugerida; onde nao houver camera, abre a galeria. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label="Tirar foto do equipamento"
          onChange={(event) => {
            void handleSelection(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          aria-label="Escolher foto do equipamento"
          onChange={(event) => {
            void handleSelection(event.target.files?.[0]);
            event.target.value = '';
          }}
        />

        {prepared ? (
          <div className="space-y-3 rounded-md border border-ink-200 p-3">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- previa local (blob:), sem otimizacao do Next */}
              <img
                src={prepared.previewUrl}
                alt="Previa da foto selecionada"
                className="h-24 w-24 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-small text-ink-600">
                  {prepared.width} × {prepared.height} px · {Math.round(prepared.file.size / 1024)}{' '}
                  KB
                </p>

                <label htmlFor="media-kind" className="block text-ui font-medium text-ink-700">
                  O que esta na foto
                </label>
                <Select id="media-kind" name="kind" defaultValue="general">
                  {MEDIA_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {MEDIA_KIND_LABEL[kind]}
                    </option>
                  ))}
                </Select>
              </div>
              <IconButton label="Descartar foto" variant="destructive" onClick={discard}>
                <IconClose size={18} />
              </IconButton>
            </div>

            <UploadButton />
          </div>
        ) : (
          <p className="text-small text-ink-500">
            Fotografe apenas o equipamento e a etiqueta. Evite incluir pessoas, documentos ou o
            ambiente ao redor.
          </p>
        )}
      </form>

      {media.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {media.map((item) => (
            <li key={item.id} className="space-y-2 rounded-md border border-ink-200 p-2">
              {/* A imagem vem da rota autenticada: nunca de diretorio publico. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- rota autenticada, fora do otimizador */}
              <img
                src={`/api/midia/${item.id}`}
                alt={item.caption ?? MEDIA_KIND_LABEL[item.kind as keyof typeof MEDIA_KIND_LABEL]}
                className="h-32 w-full rounded-md object-cover"
                loading="lazy"
              />
              <p className="truncate text-small text-ink-600">
                {MEDIA_KIND_LABEL[item.kind as keyof typeof MEDIA_KIND_LABEL]}
              </p>
              <form action={removeFormAction}>
                <input type="hidden" name="mediaId" value={item.id} />
                <input type="hidden" name="equipmentId" value={equipmentId} />
                <Button type="submit" variant="ghost" size="sm">
                  Remover
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
