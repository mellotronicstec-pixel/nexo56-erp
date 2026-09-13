import type { ReactNode } from 'react';
import { IconAlert } from '@/design-system/icons';

/**
 * Estado de erro de uma area ou pagina (Prompt 04, item 32).
 *
 * Diz o que aconteceu em portugues, oferece o proximo passo e NUNCA mostra
 * stack trace, nome de tabela, SQL ou detalhe interno — nem em erro de rede,
 * nem em falha de servidor (item 53).
 */
export function ErrorState({
  title = 'Nao foi possivel carregar',
  description = 'Tente novamente em instantes. Se continuar, fale com o administrador da sua empresa.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-full bg-danger-50 text-danger-700">
        <IconAlert size={22} />
      </span>
      <h2 className="font-heading text-h5 font-semibold text-ink-900">{title}</h2>
      <p className="mt-1 max-w-[28rem] text-ui text-ink-600">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
