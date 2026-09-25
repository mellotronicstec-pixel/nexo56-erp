'use client';

import { useState, useTransition } from 'react';
import { Button, Menu, MenuItem, MENU_ROW, Modal, Spinner } from '@/design-system/components';
import { generateAiDraftAction } from './actions';

/**
 * COMPONENTE REUTILIZAVEL DO NEXO56 AI (Prompt 20, itens 63 a 70, 121 a 126,
 * 134).
 *
 * Um menu discreto ("Melhorar com Nexo56 AI"), nao cinco botoes permanentes
 * (item 64). Cada task chama a MESMA Server Action, com `surfaceKey`
 * declarando o que e permitido — o componente nunca decide isso sozinho.
 *
 * HUMAN-IN-THE-LOOP (item 17): o resultado nunca substitui o campo direto.
 * Ele aparece num dialogo com "Original" e "Sugestao", e so vira valor do
 * formulario quando a pessoa clica "Usar texto" — que so muda o ESTADO
 * LOCAL do form (item 18, 68, 134), nunca salva a entidade.
 */

const TASK_LABELS: Record<string, string> = {
  CORRIGIR_PORTUGUES: 'Corrigir português',
  DEIXAR_MAIS_PROFISSIONAL: 'Deixar mais profissional',
  RESUMIR: 'Resumir',
  DEIXAR_MAIS_CLARO_PARA_CLIENTE: 'Deixar mais claro para o cliente',
  GERAR_PARECER_TECNICO: 'Gerar parecer técnico',
};

/** Unica task que pode rodar sem texto atual no campo (item 132). */
const TASKS_WITHOUT_REQUIRED_TEXT = new Set(['GERAR_PARECER_TECNICO']);

interface PreviewState {
  original: string;
  suggestion: string;
}

export function AiWritingMenu({
  surfaceKey,
  entityId,
  tasks,
  currentText,
  onApply,
}: {
  surfaceKey: string;
  entityId: string;
  /** Chaves de task permitidas nesta superficie (item 65) — vem do catalogo, no servidor. */
  tasks: readonly string[];
  currentText: string;
  onApply: (text: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runTask(taskKey: string) {
    if (pending) return; // evita clique duplo abrindo duas geracoes (item 66/115).
    setError(null);

    if (!TASKS_WITHOUT_REQUIRED_TEXT.has(taskKey) && currentText.trim().length === 0) {
      setError('Não há texto para melhorar.');
      return;
    }

    const snapshotText = currentText;

    startTransition(async () => {
      const result = await generateAiDraftAction({
        surfaceKey,
        taskKey,
        entityId,
        currentText: snapshotText,
      });

      if (result.ok) {
        setPreview({ original: snapshotText, suggestion: result.text });
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="inline-block">
      <Menu
        label="Nexo56 AI"
        trigger={() => (
          <span
            aria-busy={pending}
            className="flex items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1 text-small font-medium text-ink-600 transition-colors hover:bg-ink-100"
          >
            {pending ? <Spinner size="sm" label="Gerando sugestão" /> : null}
            {pending ? 'Gerando…' : 'Melhorar com Nexo56 AI'}
          </span>
        )}
      >
        {tasks.map((taskKey) => (
          <MenuItem key={taskKey}>
            <button
              type="button"
              className={MENU_ROW}
              onClick={() => runTask(taskKey)}
              disabled={pending}
            >
              {TASK_LABELS[taskKey] ?? taskKey}
            </button>
          </MenuItem>
        ))}
      </Menu>

      {error ? (
        <p role="alert" className="mt-1 text-small text-danger-700">
          {error}
        </p>
      ) : null}

      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="Rascunho gerado pela Nexo56 AI"
        description="Revise antes de usar. O texto original continua seguro até você decidir."
        size="lg"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPreview(null)}>
              Descartar
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (preview) onApply(preview.suggestion);
                setPreview(null);
              }}
            >
              Usar texto
            </Button>
          </>
        }
      >
        {preview ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-small font-semibold text-ink-500">Original</p>
              <p className="whitespace-pre-wrap text-ui text-ink-700">{preview.original || '—'}</p>
            </div>
            <div>
              <p className="mb-1 text-small font-semibold text-ink-500">Sugestão Nexo56 AI</p>
              <p className="whitespace-pre-wrap text-ui text-ink-900">{preview.suggestion}</p>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
