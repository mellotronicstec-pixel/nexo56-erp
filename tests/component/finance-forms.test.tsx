// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import { EMPTY_FINANCE_STATE, type FinanceActionState } from '@/app/(app)/financeiro/action-state';
import { NewTitleForm } from '@/app/(app)/financeiro/novo-lancamento/new-title-form';
import { SettlePanel } from '@/app/(app)/financeiro/titulos/[titleId]/settle-panel';
import {
  CancelTitleForm,
  ReverseSettlementForm,
} from '@/app/(app)/financeiro/titulos/[titleId]/title-admin';
import { CloseCashForm, OpenCashForm } from '@/app/(app)/financeiro/caixa/cash-forms';
import { FinanceSection } from '@/app/(app)/ordens-de-servico/[serviceOrderId]/finance-section';
import { PayablesSection } from '@/app/(app)/compras/[purchaseOrderId]/payables-section';

/**
 * INTERFACE DO FINANCEIRO (Prompt 12, itens 62 a 67 e 103).
 *
 * COMPORTAMENTO E ACESSIBILIDADE, nunca aparencia. O que estes testes travam e
 * exatamente o que faz a diferenca entre um financeiro confiavel e uma
 * planilha bonita:
 *
 *   - o campo de contagem do caixa NAO vem preenchido com o esperado;
 *   - estornar avisa, na tela, que nada e apagado;
 *   - a chave de comando existe e muda a cada liquidacao bem-sucedida;
 *   - quem nao pode fazer nao ve o botao, em vez de ve-lo cinza;
 *   - nenhuma tela promete PIX automatico, banco ou nota fiscal.
 */

const noop = async (): Promise<FinanceActionState> => EMPTY_FINANCE_STATE;

const CONTAS = [
  { id: 'conta-caixa', name: 'Caixa da loja', kind: 'cash' },
  { id: 'conta-banco', name: 'Banco', kind: 'bank' },
];

const FORMAS = [
  { id: 'forma-dinheiro', name: 'Dinheiro', kind: 'cash' },
  { id: 'forma-cartao', name: 'Cartao de credito', kind: 'credit_card' },
];

const PARCELAS = [
  {
    id: 'parcela-1',
    number: 1,
    amount: '300.00',
    settledAmount: '0.00',
    outstanding: '300.00',
    dueDate: '2026-04-10',
  },
  {
    id: 'parcela-2',
    number: 2,
    amount: '300.00',
    settledAmount: '100.00',
    outstanding: '200.00',
    dueDate: '2026-05-10',
  },
];

describe('lancamento manual (itens 28, 32 a 37)', () => {
  it('a conta a receber pede CLIENTE; a conta a pagar oferece favorecido sem cadastro', async () => {
    const user = userEvent.setup();

    const { unmount } = render(
      <NewTitleForm
        direction="receivable"
        unitId="unidade-1"
        unitName="Loja Centro"
        customers={[{ id: 'cliente-1', name: 'Maria Souza' }]}
        suppliers={[]}
        categories={[]}
        today="2026-04-01"
        createTitleAction={noop}
        createExpenseAction={noop}
      />,
    );

    expect(screen.getByLabelText(/Cliente/)).toBeTruthy();
    expect(screen.queryByLabelText(/Nome do favorecido/)).toBeNull();
    unmount();

    render(
      <NewTitleForm
        direction="payable"
        unitId="unidade-1"
        unitName="Loja Centro"
        customers={[]}
        suppliers={[{ id: 'fornecedor-1', name: 'Distribuidora Alfa' }]}
        categories={[]}
        today="2026-04-01"
        createTitleAction={noop}
        createExpenseAction={noop}
      />,
    );

    expect(screen.getByLabelText(/^Fornecedor \*?$/)).toBeTruthy();

    /**
     * A conta de luz nao tem fornecedor no cadastro. Obrigar a criar um so
     * para lancar a despesa e o tipo de exigencia que devolve o financeiro
     * para a planilha.
     */
    await user.click(screen.getByLabelText(/Outro \(aluguel, energia, imposto\)/));
    expect(screen.getByLabelText(/Nome do favorecido/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Fornecedor \*?$/)).toBeNull();
  });

  it('nao calcula parcelas no cliente: diz que a divisao e do servidor e soma exata', async () => {
    const user = userEvent.setup();

    render(
      <NewTitleForm
        direction="receivable"
        unitId="unidade-1"
        unitName="Loja Centro"
        customers={[{ id: 'cliente-1', name: 'Maria Souza' }]}
        suppliers={[]}
        categories={[]}
        today="2026-04-01"
        createTitleAction={noop}
        createExpenseAction={noop}
      />,
    );

    const parcelas = screen.getByLabelText(/Parcelas/) as HTMLInputElement;
    await user.clear(parcelas);
    await user.type(parcelas, '3');

    expect(screen.getByText(/soma bate exatamente com o total/i)).toBeTruthy();
    // Nenhum "R$ 33,34" calculado aqui: quem divide os centavos e o dominio.
    expect(screen.queryByText(/33,3/)).toBeNull();
  });
});

describe('liquidacao (itens 38 a 44)', () => {
  it('o botao diz "Registrar recebimento", nao "Registrar receber"', () => {
    const { unmount } = render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    expect(screen.getByRole('button', { name: 'Registrar recebimento' })).toBeTruthy();
    unmount();

    render(
      <SettlePanel
        titleId="titulo-2"
        direction="payable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    expect(screen.getByRole('button', { name: 'Registrar pagamento' })).toBeTruthy();
  });

  it('sugere o saldo da parcela, e o campo continua editavel', () => {
    render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    const valor = screen.getByLabelText(/Valor/) as HTMLInputElement;
    expect(valor.value).toBe('300,00');
    expect(valor.readOnly).toBe(false);
    expect(screen.getByText(/Pode ser menor, nunca maior/i)).toBeTruthy();
  });

  it('manda uma chave de comando junto, para o duplo clique nao lancar duas vezes (item 42)', () => {
    const { container } = render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    const chave = container.querySelector('input[name="commandKey"]') as HTMLInputElement | null;
    expect(chave).not.toBeNull();
    expect(chave?.value.length).toBeGreaterThan(10);
  });

  it('ja abre numa conta que VAI funcionar, em vez de abrir bloqueada', () => {
    render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={[]}
        today="2026-04-10"
        action={noop}
      />,
    );

    /**
     * Ordenadas por nome, "Caixa da loja" vem antes de "Banco". Com o caixa
     * fechado, abrir no caixa deixaria o formulario bloqueado antes de a
     * pessoa escolher coisa nenhuma.
     */
    expect((screen.getByLabelText(/Conta financeira/) as HTMLSelectElement).value).toBe(
      'conta-banco',
    );
    expect(screen.queryByText(/O caixa da conta/i)).toBeNull();
  });

  it('avisa ANTES do envio quando a conta ESCOLHIDA e um caixa fechado', async () => {
    const user = userEvent.setup();

    render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={[]}
        today="2026-04-10"
        action={noop}
      />,
    );

    await user.selectOptions(screen.getByLabelText(/Conta financeira/), 'conta-caixa');

    /**
     * REGRESSAO: a pergunta e sobre A CONTA ESCOLHIDA, nao sobre a loja. Com
     * duas contas em especie na mesma unidade, um booleano "ha caixa aberto
     * aqui?" dizia sim enquanto a conta do formulario continuava fechada — e a
     * recusa so aparecia depois do envio, com o dinheiro ja contado.
     */
    expect(screen.getByText(/O caixa da conta/i)).toBeTruthy();
    expect(screen.getByText(/Ter outro caixa aberto na loja nao serve/i)).toBeTruthy();
  });

  it('com o caixa daquela conta ABERTO, nao ha aviso nenhum', async () => {
    const user = userEvent.setup();

    render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    await user.selectOptions(screen.getByLabelText(/Conta financeira/), 'conta-caixa');
    expect(screen.queryByText(/O caixa da conta/i)).toBeNull();
  });

  it('parcelamento no cartao so aparece quando a forma e cartao', async () => {
    const user = userEvent.setup();

    render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    expect(screen.queryByLabelText(/Parcelas no cartao/)).toBeNull();

    await user.selectOptions(screen.getByLabelText(/Forma de pagamento/), 'forma-cartao');
    expect(screen.getByLabelText(/Parcelas no cartao/)).toBeTruthy();

    /** Registro do combinado, nao integracao: a tela diz isso em voz alta. */
    expect(screen.getByText(/nao fala com a adquirente/i)).toBeTruthy();
  });

  it('sem conta ativa na unidade, explica o motivo em vez de mostrar um formulario inutil', () => {
    render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={[]}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    expect(screen.getByText(/Nao ha conta financeira ativa para esta unidade/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Registrar/ })).toBeNull();
  });
});

describe('estorno e cancelamento (itens 31, 45 a 48)', () => {
  it('estornar diz, na propria tela, que nada e apagado', async () => {
    const user = userEvent.setup();

    render(
      <ReverseSettlementForm
        titleId="titulo-1"
        settlements={[
          {
            id: 'liq-1',
            amount: '300.00',
            effectiveDate: '2026-04-10',
            accountName: 'Caixa da loja',
            methodName: 'Dinheiro',
          },
        ]}
        action={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Estornar um lancamento/ }));

    expect(screen.getByText(/continua no historico/i)).toBeTruthy();
    expect(screen.getByText(/movimento contrario/i)).toBeTruthy();
    // O FormField liga o rotulo ao controle e marca `aria-required`, que e o
    // que o leitor de tela anuncia — nao basta o atributo `required` do HTML.
    expect(screen.getByLabelText(/Motivo/).getAttribute('aria-required')).toBe('true');
  });

  it('sem lancamento nenhum, o painel de estorno nem existe', () => {
    const { container } = render(
      <ReverseSettlementForm titleId="titulo-1" settlements={[]} action={noop} />,
    );
    expect(container.textContent).toBe('');
  });

  it('cancelar titulo exige motivo escrito', async () => {
    const user = userEvent.setup();
    render(<CancelTitleForm titleId="titulo-1" action={noop} />);

    await user.click(screen.getByRole('button', { name: 'Cancelar titulo' }));
    expect(screen.getByLabelText(/Motivo/).getAttribute('aria-required')).toBe('true');
  });
});

describe('caixa (itens 21 a 27)', () => {
  it('a abertura exige conta em dinheiro VINCULADA a unidade, e explica por que', () => {
    render(<OpenCashForm accounts={[]} action={noop} />);

    /**
     * REGRESSAO: a tela oferecia tambem a conta em especie compartilhada pela
     * empresa. A pessoa contava o troco, preenchia o valor inicial e so entao
     * levava a recusa "um caixa pertence a uma loja". O filtro passou a exigir
     * as duas condicoes, e o aviso explica ambas.
     */
    expect(screen.getByText(/Nenhuma conta de caixa esta disponivel nesta unidade/i)).toBeTruthy();
    expect(screen.getByText(/vinculada a esta loja/i)).toBeTruthy();
  });

  it('O FECHAMENTO NAO PREENCHE A CONTAGEM com o valor esperado (item 25)', async () => {
    const user = userEvent.setup();

    render(<CloseCashForm sessionId="sessao-1" expectedAmount="742.50" action={noop} />);

    /**
     * Antes de contar, a tela nem mostra o campo: ver o numero esperado
     * primeiro faz todo caixa fechar certinho, inclusive o que esta faltando.
     */
    expect(screen.queryByLabelText(/Valor contado/)).toBeNull();
    expect(screen.getByText(/Conte o dinheiro ANTES/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Ja contei/ }));

    const contado = screen.getByLabelText(/Valor contado na gaveta/) as HTMLInputElement;
    expect(contado.value).toBe('');
    expect(contado.value).not.toContain('742');
  });
});

describe('financeiro na ficha da Ordem de Servico (itens 29 e 68)', () => {
  it('sem permissao de cobranca, nao ha botao — nem cinza, nem escondido atras de erro', () => {
    render(
      <FinanceSection
        serviceOrderId="os-1"
        charge={null}
        suggestedAmount="900.00"
        suggestedDescription="Servico da OS 000042"
        today="2026-04-01"
        canCreate={false}
        action={noop}
      />,
    );

    expect(screen.queryByRole('button', { name: /Gerar cobranca/ })).toBeNull();
    expect(screen.getByText(/Nenhuma cobranca gerada/i)).toBeTruthy();
  });

  it('sugere o total do orcamento aprovado e deixa claro que da para ajustar', async () => {
    const user = userEvent.setup();

    render(
      <FinanceSection
        serviceOrderId="os-1"
        charge={null}
        suggestedAmount="900.00"
        suggestedDescription="Servico da OS 000042"
        today="2026-04-01"
        canCreate
        action={noop}
      />,
    );

    expect(screen.getByText(/desconto de balcao existe/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Gerar cobranca' }));
    expect((screen.getByLabelText(/Valor a cobrar/) as HTMLInputElement).value).toBe('900,00');
  });

  it('com a cobranca quitada, diz que pagar NAO e retirar o aparelho', () => {
    render(
      <FinanceSection
        serviceOrderId="os-1"
        charge={{
          id: 'titulo-1',
          number: 42,
          amount: '900.00',
          settledAmount: '900.00',
          outstanding: '0.00',
          status: 'settled',
          dueDate: '2026-04-10',
          installmentCount: 1,
          formattedNumber: 'CR 000042',
        }}
        suggestedAmount={null}
        suggestedDescription=""
        today="2026-04-01"
        canCreate
        action={noop}
      />,
    );

    expect(screen.getByText(/pagar\s+nao retira, e retirar nao quita/i)).toBeTruthy();
    // Com a cobranca ja criada, nao ha como criar uma segunda.
    expect(screen.queryByRole('button', { name: 'Gerar cobranca' })).toBeNull();
  });
});

describe('contas a pagar no pedido de compra (itens 33, 34, 37 e 69)', () => {
  it('sem recebimento, explica que a obrigacao nasce quando a mercadoria chega', () => {
    render(
      <PayablesSection
        purchaseOrderId="pedido-1"
        rows={[]}
        canCreate
        today="2026-04-01"
        action={noop}
      />,
    );

    expect(screen.getByText(/nasce quando a mercadoria chega/i)).toBeTruthy();
  });

  it('cada recebimento tem a SUA conta: duas entregas parciais, dois titulos', () => {
    render(
      <PayablesSection
        purchaseOrderId="pedido-1"
        rows={[
          {
            receiptId: 'rec-1',
            receivedAtLabel: '02/04/2026 10:00',
            documentNumber: '1234',
            payable: {
              id: 'titulo-1',
              formattedNumber: 'CP 000010',
              amount: '600.00',
              settledAmount: '0.00',
              outstanding: '600.00',
              status: 'open',
            },
          },
          {
            receiptId: 'rec-2',
            receivedAtLabel: '09/04/2026 11:30',
            documentNumber: null,
            payable: null,
          },
        ]}
        canCreate
        today="2026-04-09"
        action={noop}
      />,
    );

    expect(screen.getByText('CP 000010')).toBeTruthy();
    expect(screen.getByText('Sem conta a pagar')).toBeTruthy();
    // Um formulario so: o recebimento que ja tem conta nao oferece outro.
    expect(screen.getAllByRole('button', { name: 'Gerar conta a pagar' })).toHaveLength(1);
    expect(screen.getByText(/duas entregas parciais somam exatamente o que chegou/i)).toBeTruthy();
  });

  it('sem permissao, nenhum recebimento oferece gerar conta', () => {
    render(
      <PayablesSection
        purchaseOrderId="pedido-1"
        rows={[
          {
            receiptId: 'rec-2',
            receivedAtLabel: '09/04/2026 11:30',
            documentNumber: null,
            payable: null,
          },
        ]}
        canCreate={false}
        today="2026-04-09"
        action={noop}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Gerar conta a pagar' })).toBeNull();
  });
});

describe('nenhuma tela promete o que o Nexo56 nao faz (itens 109 e 118)', () => {
  it('a liquidacao nao fala em PIX automatico, banco nem nota fiscal', () => {
    const { container } = render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    const texto = (container.textContent ?? '').toLowerCase();
    expect(texto).not.toContain('nota fiscal');
    expect(texto).not.toContain('conciliacao bancaria');
    expect(texto).not.toContain('pix automatico');
  });

  it('nenhum formulario de liquidacao pede numero de cartao ou CVV (item 109)', () => {
    const { container } = render(
      <SettlePanel
        titleId="titulo-1"
        direction="receivable"
        installments={PARCELAS}
        accounts={CONTAS}
        methods={FORMAS}
        accountsWithOpenCash={['conta-caixa']}
        today="2026-04-10"
        action={noop}
      />,
    );

    const campos = [...container.querySelectorAll('input, textarea')].map((campo) =>
      (campo.getAttribute('name') ?? '').toLowerCase(),
    );

    for (const proibido of ['cardnumber', 'cvv', 'securitycode', 'cartao']) {
      expect(campos).not.toContain(proibido);
    }
  });
});
