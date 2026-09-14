// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import { EMPTY_INVENTORY_STATE, type InventoryActionState } from '@/app/(app)/estoque/action-state';
import { PartForm } from '@/app/(app)/estoque/part-form';
import { StockOperations } from '@/app/(app)/estoque/[partId]/stock-operations';
import { PartsSection } from '@/app/(app)/ordens-de-servico/[serviceOrderId]/parts-section';
import { QuoteEditor } from '@/app/(app)/ordens-de-servico/[serviceOrderId]/orcamentos/quote-editor';
import {
  EMPTY_QUOTE_STATE,
  type QuoteActionState,
} from '@/app/(app)/ordens-de-servico/[serviceOrderId]/orcamentos/action-state';

/**
 * INTERFACE DE ESTOQUE (Prompt 10, item 141).
 *
 * Comportamento e acessibilidade, nunca aparencia. O que estes testes travam:
 * nenhuma operacao acontece sem confirmacao, o ajuste exige motivo, e o que a
 * pessoa nao pode fazer simplesmente nao aparece.
 */

const noop = async (): Promise<InventoryActionState> => EMPTY_INVENTORY_STATE;

const TODAS: Parameters<typeof StockOperations>[0]['can'] = {
  receive: true,
  issue: true,
  adjust: true,
  transfer: true,
  minimum: true,
};

function renderOperations(overrides: Partial<Parameters<typeof StockOperations>[0]> = {}) {
  return render(
    <StockOperations
      partId={overrides.partId ?? 'peca-1'}
      unitId={overrides.unitId ?? 'unidade-1'}
      unitName={overrides.unitName ?? 'Unidade Centro'}
      unitOfMeasureLabel={overrides.unitOfMeasureLabel ?? 'Unidade'}
      minimumQuantity={overrides.minimumQuantity ?? '0'}
      locations={overrides.locations ?? [{ id: 'loc-1', name: 'Prateleira A' }]}
      transferTargets={overrides.transferTargets ?? [{ id: 'unidade-2', name: 'Unidade Bairro' }]}
      can={overrides.can ?? TODAS}
      actions={
        overrides.actions ?? {
          receive: noop,
          issue: noop,
          adjust: noop,
          transfer: noop,
          minimum: noop,
        }
      }
    />,
  );
}

describe('cadastro de peca (itens 11 a 14)', () => {
  it('exige codigo interno e nome, e nada mais', () => {
    render(<PartForm action={noop} submitLabel="Cadastrar peca" />);

    expect((screen.getByLabelText(/Codigo interno/) as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText(/^Nome/) as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText(/Fabricante/) as HTMLInputElement).required).toBe(false);
    expect((screen.getByLabelText(/Part number/) as HTMLInputElement).required).toBe(false);
    expect((screen.getByLabelText(/Codigo de barras/) as HTMLInputElement).required).toBe(false);
  });

  it('diz, na propria tela, que nao ha leitor de codigo de barras (item 114)', () => {
    render(<PartForm action={noop} submitLabel="Cadastrar peca" />);
    expect(screen.getByText(/Ainda nao ha leitor de camera/)).toBeTruthy();
  });

  it('avisa que o preco sugerido nao e o preco aprovado (item 19)', () => {
    render(<PartForm action={noop} submitLabel="Cadastrar peca" />);
    expect(screen.getByText(/O valor que vale e o aprovado no orcamento/)).toBeTruthy();
  });
});

describe('operacoes de estoque (itens 101 a 107)', () => {
  it('nenhuma operacao acontece sem abrir o dialogo de confirmacao', async () => {
    const user = userEvent.setup();
    renderOperations();

    // Nenhum campo de quantidade solto na tela.
    expect(screen.queryByLabelText(/Quantidade/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Entrada' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Registrar entrada' })).toBeTruthy();
  });

  it('o ajuste exige motivo e avisa que fica na auditoria (itens 55 e 107)', async () => {
    const user = userEvent.setup();
    renderOperations();

    await user.click(screen.getByRole('button', { name: 'Ajustar saldo' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    const motivo = screen.getByLabelText(/^Motivo/) as HTMLTextAreaElement;
    expect(motivo.required).toBe(true);
    expect(screen.getByText(/fica registrado na auditoria/i)).toBeTruthy();
  });

  it('a entrada manda chave de comando: duplo clique nao lanca duas vezes (item 119)', async () => {
    const user = userEvent.setup();
    const { container } = renderOperations();

    await user.click(screen.getByRole('button', { name: 'Entrada' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    const chave = container.querySelector<HTMLInputElement>('input[name="idempotencyKey"]');
    expect(chave?.value).toMatch(/^entrada-/);
    expect(chave?.value.length).toBeGreaterThan(20);
  });

  it('a transferencia declara a limitacao: e imediata (item 53)', async () => {
    const user = userEvent.setup();
    renderOperations();

    await user.click(screen.getByRole('button', { name: 'Transferir' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText(/O sistema nao acompanha o transporte/)).toBeTruthy();
  });

  it('quem nao pode ajustar nao ve o botao de ajuste (item 90)', () => {
    renderOperations({ can: { ...TODAS, adjust: false, transfer: false } });

    expect(screen.queryByRole('button', { name: 'Ajustar saldo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transferir' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Entrada' })).toBeTruthy();
  });

  it('sem permissao nenhuma, a tela diz o que a pessoa pode fazer', () => {
    renderOperations({
      can: { receive: false, issue: false, adjust: false, transfer: false, minimum: false },
    });

    expect(screen.getByText(/nao movimenta-lo/)).toBeTruthy();
  });

  it('a acao chega ao servidor com a peca e a unidade certas', async () => {
    const user = userEvent.setup();
    const receive = vi.fn(async (): Promise<InventoryActionState> => EMPTY_INVENTORY_STATE);

    const { container } = renderOperations({
      actions: { receive, issue: noop, adjust: noop, transfer: noop, minimum: noop },
    });

    await user.click(screen.getByRole('button', { name: 'Entrada' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    expect(container.querySelector<HTMLInputElement>('input[name="partId"]')?.value).toBe('peca-1');
    expect(container.querySelector<HTMLInputElement>('input[name="unitId"]')?.value).toBe(
      'unidade-1',
    );
  });
});

describe('pecas na Ordem de Servico (itens 69 e 103 a 105)', () => {
  const reserva = {
    id: 'res-1',
    partId: 'peca-1',
    partCode: 'TELA-01',
    partName: 'Tela LCD',
    unitOfMeasure: 'unit',
    quantity: '3.0000',
    consumedQuantity: '1.0000',
    remaining: '2.0000',
    status: 'open',
  };

  function renderSection(overrides: Partial<Parameters<typeof PartsSection>[0]> = {}) {
    return render(
      <PartsSection
        serviceOrderId={overrides.serviceOrderId ?? 'os-1'}
        reservations={overrides.reservations ?? [reserva]}
        parts={overrides.parts ?? [{ id: 'peca-1', code: 'TELA-01', name: 'Tela LCD' }]}
        canReserve={overrides.canReserve ?? true}
        canConsume={overrides.canConsume ?? true}
        reserveAction={overrides.reserveAction ?? noop}
        releaseAction={overrides.releaseAction ?? noop}
        consumeAction={overrides.consumeAction ?? noop}
      />,
    );
  }

  it('mostra reservado, consumido e o que ainda esta em aberto', () => {
    renderSection();
    expect(screen.getByText('Tela LCD')).toBeTruthy();
    expect(screen.getByText('TELA-01')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('sem reserva, explica que aprovar orcamento nao reserva sozinho (item 36)', () => {
    renderSection({ reservations: [] });
    expect(screen.getByText(/Aprovar orcamento nao reserva sozinho/)).toBeTruthy();
  });

  it('sem catalogo, diz o que falta em vez de oferecer um botao que falha', () => {
    renderSection({ reservations: [], parts: [] });
    expect(screen.queryByRole('button', { name: 'Reservar peca' })).toBeNull();
    expect(screen.getByText(/Cadastre a peca em Estoque primeiro/)).toBeTruthy();
  });

  it('reservar oferece as pecas do catalogo, e nao um campo de identificador', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Reservar peca' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    const seletor = screen.getByLabelText(/^Peca/) as HTMLSelectElement;
    expect(seletor.tagName).toBe('SELECT');
    expect(seletor.required).toBe(true);
  });

  it('consumir avisa que a situacao da OS nao muda (itens 46 e 47)', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'Consumir' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText(/A situacao da Ordem de Servico nao muda/)).toBeTruthy();
  });

  it('quem nao pode dar saida nao ve o botao de consumir', () => {
    renderSection({ canConsume: false });
    expect(screen.queryByRole('button', { name: 'Consumir' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Liberar' })).toBeTruthy();
  });
});

describe('seletor de peca no orcamento (itens 108 a 110)', () => {
  const quoteNoop = async (): Promise<QuoteActionState> => EMPTY_QUOTE_STATE;

  function renderEditor(parts: Parameters<typeof QuoteEditor>[0]['parts']) {
    return render(
      <QuoteEditor
        serviceOrderId="os-1"
        quoteId="orc-1"
        version={1}
        initialItems={[
          {
            kind: 'part',
            description: 'Tela comprada avulsa',
            quantity: '1',
            unitPrice: '500.00',
            discount: '',
            partId: '',
          },
        ]}
        initialDiscount="0.00"
        initialValidUntil=""
        initialCustomerNotes=""
        initialInternalNotes=""
        action={quoteNoop}
        parts={parts}
      />,
    );
  }

  it('sem catalogo disponivel, a linha PART continua funcionando a mao (item 86)', () => {
    renderEditor([]);
    expect(screen.queryByLabelText(/Peca do catalogo/)).toBeNull();
    expect((screen.getAllByLabelText(/^Descricao/)[0] as HTMLInputElement).value).toBe(
      'Tela comprada avulsa',
    );
  });

  it('com catalogo, escolher a peca preenche descricao e valor como conveniencia', async () => {
    const user = userEvent.setup();
    const { container } = renderEditor([
      { id: 'peca-1', code: 'TELA-01', name: 'Tela LCD 32', suggestedPrice: '450.00' },
    ]);

    await user.selectOptions(screen.getByLabelText(/Peca do catalogo/), 'peca-1');

    expect((screen.getAllByLabelText(/^Descricao/)[0] as HTMLInputElement).value).toBe(
      'TELA-01 — Tela LCD 32',
    );
    expect(container.querySelector<HTMLInputElement>('input[name="itemPartId"]')?.value).toBe(
      'peca-1',
    );
  });

  it('o vinculo viaja em TODA linha, inclusive vazio, para os indices nao desalinharem', () => {
    const { container } = renderEditor([
      { id: 'peca-1', code: 'TELA-01', name: 'Tela LCD 32', suggestedPrice: null },
    ]);

    const linhas = container.querySelectorAll('[data-testid="item-row"]');
    const vinculos = container.querySelectorAll('input[name="itemPartId"]');
    expect(vinculos.length).toBe(linhas.length);
  });

  it('avisa que escolher a peca nao reserva nem movimenta estoque (item 36)', () => {
    renderEditor([{ id: 'peca-1', code: 'TELA-01', name: 'Tela LCD 32', suggestedPrice: null }]);
    expect(screen.getByText(/nao reserva nem movimenta estoque/)).toBeTruthy();
  });
});
