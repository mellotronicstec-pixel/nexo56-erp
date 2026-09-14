// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import {
  EMPTY_PURCHASING_STATE,
  type PurchasingActionState,
} from '@/app/(app)/compras/action-state';
import { SupplierForm } from '@/app/(app)/fornecedores/supplier-form';
import { NewNeedForm } from '@/app/(app)/compras/necessidades/need-forms';
import { PurchaseDraftEditor } from '@/app/(app)/compras/[purchaseOrderId]/draft-editor';
import { PurchaseOrderWorkflow } from '@/app/(app)/compras/[purchaseOrderId]/order-workflow';
import { ReceivePanel } from '@/app/(app)/compras/[purchaseOrderId]/receive-panel';

/**
 * INTERFACE DE FORNECEDORES E COMPRAS (Prompt 11, itens 61 a 68).
 *
 * Comportamento e acessibilidade, nunca aparencia. O que estes testes travam:
 * o que a pessoa nao pode fazer nao aparece, cancelar exige motivo escrito, o
 * recebimento ja sugere o que falta em vez de exigir que alguem some de
 * cabeca, e nenhuma tela promete enviar coisa nenhuma ao fornecedor.
 */

const noop = async (): Promise<PurchasingActionState> => EMPTY_PURCHASING_STATE;

const PECAS = [
  { id: 'peca-1', code: 'TELA-01', name: 'Tela LCD', unitOfMeasure: 'unit' },
  { id: 'peca-2', code: 'FONTE-01', name: 'Fonte 12V', unitOfMeasure: 'unit' },
];

describe('cadastro de fornecedor (itens 4 e 5)', () => {
  it('so o nome e obrigatorio: documento, telefone e endereco sao opcionais', () => {
    render(<SupplierForm action={noop} submitLabel="Cadastrar fornecedor" />);

    expect((screen.getByLabelText(/Razao social ou nome/) as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText(/CNPJ ou CPF/) as HTMLInputElement).required).toBe(false);
    // "Telefone" aparece duas vezes: o da empresa e o do contato. O primeiro
    // e o da empresa, e nenhum dos dois e obrigatorio.
    expect((screen.getAllByLabelText('Telefone')[0] as HTMLInputElement).required).toBe(false);
    expect((screen.getByLabelText(/Logradouro/) as HTMLInputElement).required).toBe(false);
  });

  it('diz, na propria tela, que o Nexo56 nao envia mensagem nenhuma (item 87)', () => {
    render(<SupplierForm action={noop} submitLabel="Cadastrar fornecedor" />);
    expect(screen.getByText(/nao envia mensagem nenhuma/i)).toBeTruthy();
  });

  it('a lista de contatos cresce e encolhe, mas nunca fica sem nenhuma linha', async () => {
    const user = userEvent.setup();
    render(<SupplierForm action={noop} submitLabel="Cadastrar fornecedor" />);

    expect(screen.getAllByRole('group', { name: /Contato \d/ })).toHaveLength(1);
    // Com uma linha so, remover fica indisponivel: um formulario sem nenhuma
    // linha de contato nao teria como voltar a ter uma.
    expect((screen.getByRole('button', { name: /Remover/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'Adicionar contato' }));
    expect(screen.getAllByRole('group', { name: /Contato \d/ })).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: /Remover/ })[0] as HTMLElement);
    expect(screen.getAllByRole('group', { name: /Contato \d/ })).toHaveLength(1);
  });
});

describe('necessidade de compra (itens 8 e 9)', () => {
  it('a tela diz que registrar NAO compra nada', () => {
    render(<NewNeedForm action={noop} unitId="unidade-1" parts={PECAS} />);
    expect(screen.getByText(/Nao compra nada e nao avisa ninguem/i)).toBeTruthy();
  });

  it('quando veio de uma OS, o vinculo e explicito e diz que a OS nao muda', () => {
    render(
      <NewNeedForm
        action={noop}
        unitId="unidade-1"
        parts={PECAS}
        serviceOrder={{ id: 'os-1', label: 'OS 000042' }}
      />,
    );

    expect(screen.getByText(/OS 000042/)).toBeTruthy();
    expect(screen.getByText(/situacao da Ordem de Servico nao muda/i)).toBeTruthy();
  });
});

describe('editor do rascunho do pedido (itens 14 e 15)', () => {
  function renderEditor(overrides: Partial<Parameters<typeof PurchaseDraftEditor>[0]> = {}) {
    return render(
      <PurchaseDraftEditor
        purchaseOrderId={overrides.purchaseOrderId ?? 'pedido-1'}
        initialItems={overrides.initialItems ?? []}
        initialDiscount={overrides.initialDiscount ?? '0.00'}
        initialFreight={overrides.initialFreight ?? '0.00'}
        initialOtherCosts={overrides.initialOtherCosts ?? '0.00'}
        initialExpectedAt={overrides.initialExpectedAt ?? ''}
        initialInternalNotes={overrides.initialInternalNotes ?? ''}
        initialSupplierNotes={overrides.initialSupplierNotes ?? ''}
        parts={overrides.parts ?? PECAS}
        needs={overrides.needs ?? []}
        action={overrides.action ?? noop}
      />,
    );
  }

  it('a previa do total soma itens, desconto, frete e outros custos', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.selectOptions(screen.getByLabelText(/^Peca/), 'peca-1');
    await user.clear(screen.getByLabelText(/Quantidade/));
    await user.type(screen.getByLabelText(/Quantidade/), '10');
    await user.type(screen.getByLabelText(/Custo unitario/), '25,00');
    await user.type(screen.getByLabelText(/^Frete/), '30,00');

    // 10 x 25,00 = 250,00 de itens, mais 30,00 de frete.
    await waitFor(() => {
      expect(screen.getByText('R$ 250,00')).toBeTruthy();
      expect(screen.getByText('R$ 280,00')).toBeTruthy();
    });
  });

  it('a tela avisa que frete NAO entra no custo da peca (ADR-051)', () => {
    renderEditor();
    expect(screen.getByText(/NAO sao diluidos no custo de cada peca/i)).toBeTruthy();
  });

  it('a previa e declarada como previa: quem calcula de verdade e o servidor', () => {
    renderEditor();
    expect(screen.getByText(/valor que vale e o que o servidor grava/i)).toBeTruthy();
  });

  it('a linha so oferece vinculo com necessidade DA PECA escolhida (item 29)', async () => {
    const user = userEvent.setup();
    renderEditor({
      needs: [{ id: 'nec-1', partId: 'peca-2', label: 'FONTE-01 — falta 3' }],
    });

    const vinculo = screen.getByLabelText(/Atende a necessidade/) as HTMLSelectElement;
    // Sem peca escolhida, nao ha necessidade compativel: o campo fica inerte.
    expect(vinculo.disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText(/^Peca/), 'peca-2');
    expect((screen.getByLabelText(/Atende a necessidade/) as HTMLSelectElement).disabled).toBe(
      false,
    );
    expect(screen.getByRole('option', { name: /FONTE-01 — falta 3/ })).toBeTruthy();
  });
});

describe('transicoes do pedido (itens 16, 17, 18 e 25)', () => {
  it('nao existe botao "marcar como recebido": receber e consequencia do que chegou', () => {
    render(
      <PurchaseOrderWorkflow
        purchaseOrderId="pedido-1"
        transitions={[
          {
            to: 'placed',
            label: 'Registrar pedido realizado',
            description: 'Voce confirma que o pedido foi feito.',
            requiresReason: false,
          },
        ]}
        action={noop}
      />,
    );

    expect(screen.queryByRole('button', { name: /marcar como recebido/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Receber/i })).toBeNull();
  });

  it('a tela diz que registrar o pedido NAO envia nada ao fornecedor (item 18)', () => {
    render(
      <PurchaseOrderWorkflow
        purchaseOrderId="pedido-1"
        transitions={[
          {
            to: 'placed',
            label: 'Registrar pedido realizado',
            description: 'Voce confirma que o pedido foi feito ao fornecedor.',
            requiresReason: false,
          },
        ]}
        action={noop}
      />,
    );
    expect(screen.getByText(/NAO envia nada ao fornecedor/i)).toBeTruthy();
  });

  it('sem transicao possivel, o painel inteiro desaparece em vez de mostrar botao morto', () => {
    const { container } = render(
      <PurchaseOrderWorkflow purchaseOrderId="pedido-1" transitions={[]} action={noop} />,
    );
    expect(container.textContent).toBe('');
  });

  it('cancelar abre dialogo e exige motivo escrito', async () => {
    const user = userEvent.setup();
    render(
      <PurchaseOrderWorkflow
        purchaseOrderId="pedido-1"
        transitions={[
          {
            to: 'cancelled',
            label: 'Cancelar pedido',
            description: '',
            requiresReason: true,
          },
        ]}
        action={noop}
      />,
    );

    // Antes do clique nao ha campo de motivo: cancelar nao acontece de imediato.
    expect(screen.queryByLabelText(/Motivo do cancelamento/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancelar pedido' }));

    const motivo = (await screen.findByLabelText(/Motivo do cancelamento/)) as HTMLTextAreaElement;
    expect(motivo.required).toBe(true);
  });

  it('quem nao tem a permissao nao ve o botao: nada fica cinza na tela', () => {
    render(<PurchaseOrderWorkflow purchaseOrderId="pedido-1" transitions={[]} action={noop} />);
    expect(screen.queryByRole('button', { name: /Aprovar/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancelar/i })).toBeNull();
  });
});

describe('recebimento (itens 19 a 24)', () => {
  const LINHAS = [
    {
      itemId: 'item-1',
      description: 'Tela LCD',
      unitOfMeasure: 'un',
      ordered: '10',
      received: '4',
      pending: '6',
    },
  ];

  it('o campo ja vem com o que falta, e a tela mostra pedido, recebido e pendente', () => {
    render(
      <ReceivePanel
        purchaseOrderId="pedido-1"
        lines={LINHAS}
        locations={[{ id: 'loc-1', name: 'Prateleira A' }]}
        action={noop}
      />,
    );

    const quantidade = screen.getByLabelText(/Quantidade que chegou/) as HTMLInputElement;
    expect(quantidade.defaultValue).toBe('6');
    expect(screen.getByText(/Pedido: 10 un/)).toBeTruthy();
    expect(screen.getByText(/Ja recebido: 4 un/)).toBeTruthy();
  });

  it('item ja totalmente recebido nao aparece para receber de novo', () => {
    render(
      <ReceivePanel
        purchaseOrderId="pedido-1"
        lines={[{ ...LINHAS[0]!, received: '10', pending: '0' }]}
        locations={[]}
        action={noop}
      />,
    );

    expect(screen.queryByLabelText(/Quantidade que chegou/)).toBeNull();
    expect(screen.getByText(/ja foram recebidos/i)).toBeTruthy();
  });

  it('a tela diz que o estoque sobe agora, e so agora (item 19)', () => {
    render(<ReceivePanel purchaseOrderId="pedido-1" lines={LINHAS} locations={[]} action={noop} />);
    expect(screen.getByText(/O estoque desta unidade sobe agora, e so agora/i)).toBeTruthy();
  });

  it('a chave de comando viaja no formulario: duplo clique nao lanca duas vezes', () => {
    const { container } = render(
      <ReceivePanel purchaseOrderId="pedido-1" lines={LINHAS} locations={[]} action={noop} />,
    );

    const chave = container.querySelector('input[name="commandKey"]') as HTMLInputElement | null;
    expect(chave?.value).toBeTruthy();
  });

  it('cada linha manda uma localizacao, mesmo quando a unidade nao tem prateleira', () => {
    const { container } = render(
      <ReceivePanel purchaseOrderId="pedido-1" lines={LINHAS} locations={[]} action={noop} />,
    );

    // As listas paralelas precisam ter o mesmo tamanho: sem este campo oculto,
    // a localizacao da segunda linha escorregaria para a primeira.
    expect(container.querySelectorAll('input[name="receiveItemId"]')).toHaveLength(1);
    expect(container.querySelectorAll('[name="receiveLocationId"]')).toHaveLength(1);
  });
});

describe('nenhuma tela de Compras promete Financeiro (itens 41 e 88)', () => {
  it('o painel de recebimento nao fala em pagar, titulo ou conta a pagar', () => {
    const { container } = render(
      <ReceivePanel
        purchaseOrderId="pedido-1"
        lines={[
          {
            itemId: 'item-1',
            description: 'Tela LCD',
            unitOfMeasure: 'un',
            ordered: '2',
            received: '0',
            pending: '2',
          },
        ]}
        locations={[]}
        action={noop}
      />,
    );

    const texto = container.textContent ?? '';
    for (const proibido of ['conta a pagar', 'contas a pagar', 'pagamento', 'titulo financeiro']) {
      expect(texto.toLowerCase()).not.toContain(proibido);
    }
  });
});

/** O `vi` importado acima documenta a intencao de nao usar mock aqui. */
void vi;
