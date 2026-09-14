// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import {
  EMPTY_QUOTE_STATE,
  type QuoteActionState,
} from '@/app/(app)/ordens-de-servico/[serviceOrderId]/orcamentos/action-state';
import {
  QuoteDecision,
  QuoteEditor,
} from '@/app/(app)/ordens-de-servico/[serviceOrderId]/orcamentos/quote-editor';
import { MoneyInput } from '@/design-system/components';

/**
 * EDITOR DE ORCAMENTO (Prompt 09, item 126).
 *
 * Comportamento e acessibilidade, nunca aparencia. O que estes testes travam:
 * a pessoa consegue montar a proposta, ve o total mudar enquanto digita em
 * pt-BR, e nenhuma decisao acontece sem confirmacao explicita.
 */

const noop = async (): Promise<QuoteActionState> => EMPTY_QUOTE_STATE;

function renderEditor(overrides: Partial<Parameters<typeof QuoteEditor>[0]> = {}) {
  return render(
    <QuoteEditor
      serviceOrderId={overrides.serviceOrderId ?? 'os-1'}
      quoteId={overrides.quoteId ?? 'orc-1'}
      version={overrides.version ?? 3}
      initialItems={overrides.initialItems ?? []}
      initialDiscount={overrides.initialDiscount ?? '0.00'}
      initialValidUntil={overrides.initialValidUntil ?? ''}
      initialCustomerNotes={overrides.initialCustomerNotes ?? ''}
      initialInternalNotes={overrides.initialInternalNotes ?? ''}
      action={overrides.action ?? noop}
    />,
  );
}

describe('estrutura do editor (itens 84 e 85)', () => {
  it('comeca com uma linha pronta para digitar', () => {
    const { container } = renderEditor();
    expect(container.querySelectorAll('[data-testid="item-row"]')).toHaveLength(1);
  });

  it('a descricao e obrigatoria e nao depende de catalogo (item 33)', () => {
    renderEditor();
    const descricao = screen.getAllByLabelText(/^Descricao/)[0] as HTMLInputElement;
    expect(descricao.required).toBe(true);
    // Campo de texto livre, nao um seletor de produto.
    expect(descricao.tagName).toBe('INPUT');
  });

  it('adiciona e remove linhas', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Adicionar item' }));
    expect(container.querySelectorAll('[data-testid="item-row"]')).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: /^Remover/ })[0]!);
    expect(container.querySelectorAll('[data-testid="item-row"]')).toHaveLength(1);
  });

  it('remover a ultima linha deixa uma linha em branco, nao um editor vazio', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor();

    await user.click(screen.getAllByRole('button', { name: /^Remover/ })[0]!);
    expect(container.querySelectorAll('[data-testid="item-row"]')).toHaveLength(1);
  });

  it('oferece servico, peca e outros (item 30)', () => {
    renderEditor();
    const tipo = screen.getAllByLabelText('Tipo')[0] as HTMLSelectElement;
    expect([...tipo.options].map((option) => option.text)).toEqual(['Servico', 'Peca', 'Outros']);
  });

  it('a versao lida viaja no formulario (item 96)', () => {
    const { container } = renderEditor({ version: 7 });
    const version = container.querySelector('input[name="expectedVersion"]') as HTMLInputElement;
    expect(version.value).toBe('7');
  });
});

describe('total em tempo real, em pt-BR (itens 87 a 91)', () => {
  it('soma quantidade x valor unitario enquanto a pessoa digita', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getAllByLabelText(/^Descricao/)[0]!, 'Mao de obra');
    await user.clear(screen.getAllByLabelText('Quantidade')[0]!);
    await user.type(screen.getAllByLabelText('Quantidade')[0]!, '2');
    await user.type(screen.getAllByLabelText(/Valor unitario/)[0]!, '80,00');

    await waitFor(() => expect(screen.getByTestId('quote-total').textContent).toMatch(/160,00/));
  });

  it('entende "1.234,56" como mil duzentos e trinta e quatro — nao como 1,23', async () => {
    /**
     * O defeito que este teste impede: interpretar o ponto de milhar como
     * separador decimal faria o orcamento sair mil vezes menor, e ninguem
     * perceberia ate o cliente chegar para pagar.
     */
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getAllByLabelText(/^Descricao/)[0]!, 'Placa');
    await user.type(screen.getAllByLabelText(/Valor unitario/)[0]!, '1.234,56');

    await waitFor(() => expect(screen.getByTestId('quote-total').textContent).toMatch(/1\.234,56/));
  });

  it('quantidade fracionada com virgula funciona', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getAllByLabelText(/^Descricao/)[0]!, 'Meia hora');
    await user.clear(screen.getAllByLabelText('Quantidade')[0]!);
    await user.type(screen.getAllByLabelText('Quantidade')[0]!, '0,5');
    await user.type(screen.getAllByLabelText(/Valor unitario/)[0]!, '90,00');

    await waitFor(() => expect(screen.getByTestId('quote-total').textContent).toMatch(/45,00/));
  });

  it('o desconto no total reduz o valor', async () => {
    const user = userEvent.setup();
    renderEditor({
      initialItems: [
        {
          kind: 'service',
          description: 'Bancada',
          quantity: '1',
          unitPrice: '200.00',
          discount: '',
          partId: '',
        },
      ],
    });

    await user.type(screen.getByLabelText(/Desconto no total/), '50,00');
    await waitFor(() => expect(screen.getByTestId('quote-total').textContent).toMatch(/150,00/));
  });

  it('digitacao incompleta nao quebra a previa', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getAllByLabelText(/Valor unitario/)[0]!, 'R$');
    expect(screen.getByTestId('quote-total').textContent).toMatch(/0,00/);
  });

  it('diz que a previa nao e a autoridade (item 36)', () => {
    renderEditor();
    expect(screen.getByText(/recalculado pelo servidor ao salvar/i)).toBeTruthy();
  });

  it('carrega os valores ja gravados', () => {
    renderEditor({
      initialItems: [
        {
          kind: 'part',
          description: 'Fonte',
          quantity: '1',
          unitPrice: '149.90',
          discount: '',
          partId: '',
        },
      ],
    });
    expect(screen.getByTestId('quote-total').textContent).toMatch(/149,90/);
  });
});

describe('campo de dinheiro (item 90)', () => {
  it('abre teclado numerico no celular e aceita virgula', () => {
    render(<MoneyInput aria-label="Valor" defaultValue="149.90" />);
    const campo = screen.getByLabelText('Valor') as HTMLInputElement;

    // `type="number"` recusaria a virgula em boa parte dos navegadores.
    expect(campo.type).toBe('text');
    expect(campo.inputMode).toBe('decimal');
    expect(campo.value).toBe('149,90');
  });

  it('normaliza a exibicao ao SAIR do campo, nao a cada tecla', async () => {
    const user = userEvent.setup();
    render(
      <>
        <MoneyInput aria-label="Valor" />
        <button type="button">fora</button>
      </>,
    );

    const campo = screen.getByLabelText('Valor') as HTMLInputElement;
    await user.type(campo, '1234,5');
    // Enquanto digita, o texto e o da pessoa: reformatar moveria o cursor.
    expect(campo.value).toBe('1234,5');

    await user.click(screen.getByRole('button', { name: 'fora' }));
    expect(campo.value).toBe('1.234,50');
  });
});

describe('condicoes comerciais (itens 22, 46 e 47)', () => {
  it('a validade e opcional e diz que nao ha prazo padrao', () => {
    renderEditor();
    const validade = screen.getByLabelText(/Valido ate/) as HTMLInputElement;
    expect(validade.type).toBe('date');
    expect(validade.required).toBe(false);
    expect(screen.getByText(/Nao ha prazo padrao definido/i)).toBeTruthy();
  });

  it('separa o texto do cliente do recado interno (item 47)', () => {
    renderEditor();
    expect(screen.getByLabelText(/Observacoes para o cliente/)).toBeTruthy();
    expect(screen.getByLabelText(/Observacoes internas/)).toBeTruthy();
    expect(screen.getByText(/Nao vai ao cliente/i)).toBeTruthy();
  });

  it('o desconto e em VALOR, e diz que percentual ainda nao existe (item 39)', () => {
    renderEditor();
    expect(screen.getByText(/Percentual chega quando houver decisao comercial/i)).toBeTruthy();
  });
});

describe('decisoes exigem confirmacao explicita (item 94)', () => {
  function renderDecision(overrides: Partial<Parameters<typeof QuoteDecision>[0]> = {}) {
    return render(
      <QuoteDecision
        serviceOrderId="os-1"
        quoteId="orc-1"
        version={2}
        label={overrides.label ?? 'Registrar recusa'}
        title={overrides.title ?? 'Registrar recusa do cliente'}
        description={overrides.description ?? 'A Ordem de Servico NAO e cancelada.'}
        confirmLabel={overrides.confirmLabel ?? 'Registrar recusa'}
        requiresReason={overrides.requiresReason ?? false}
        action={overrides.action ?? noop}
      />,
    );
  }

  it('o clique abre um dialogo dizendo o que vai acontecer', async () => {
    const user = userEvent.setup();
    renderDecision();

    await user.click(screen.getByRole('button', { name: 'Registrar recusa' }));

    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByText(/NAO e cancelada/i)).toBeTruthy();
  });

  it('a recusa EXIGE motivo escrito (item 21)', async () => {
    const user = userEvent.setup();
    renderDecision({ requiresReason: true });

    await user.click(screen.getByRole('button', { name: 'Registrar recusa' }));
    const motivo = screen.getByLabelText(/^Motivo/) as HTMLTextAreaElement;
    expect(motivo.required).toBe(true);
    expect(motivo.maxLength).toBe(300);
  });

  it('da para voltar sem executar nada', async () => {
    const user = userEvent.setup();
    renderDecision();

    await user.click(screen.getByRole('button', { name: 'Registrar recusa' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no ERRO o dialogo permanece aberto, com o aviso visivel', async () => {
    const user = userEvent.setup();
    const recusa = async (): Promise<QuoteActionState> => ({
      error: 'Este orcamento foi alterado por outra pessoa.',
      success: null,
    });
    renderDecision({ action: recusa, confirmLabel: 'Registrar recusa' });

    await user.click(screen.getByRole('button', { name: 'Registrar recusa' }));
    const dialogo = screen.getByRole('dialog');
    await user.click(within(dialogo).getByRole('button', { name: 'Registrar recusa' }));

    await waitFor(() => expect(screen.getByText(/alterado por outra pessoa/i)).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('no SUCESSO o dialogo fecha sozinho', async () => {
    const user = userEvent.setup();
    renderDecision({ confirmLabel: 'Registrar recusa' });

    await user.click(screen.getByRole('button', { name: 'Registrar recusa' }));
    const dialogo = screen.getByRole('dialog');
    await user.click(within(dialogo).getByRole('button', { name: 'Registrar recusa' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
