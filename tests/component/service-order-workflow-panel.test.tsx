// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import {
  EMPTY_SERVICE_ORDER_STATE,
  type ServiceOrderActionState,
} from '@/app/(app)/ordens-de-servico/action-state';
import {
  FollowUpPanel,
  NotifyCustomerPanel,
  PartPickupPanel,
  TechnicianPanel,
  WorkflowPanel,
  type TransitionOption,
} from '@/app/(app)/ordens-de-servico/[serviceOrderId]/workflow-panel';

/**
 * PAINEL DE WORKFLOW (Prompt 08, itens 79, 80, 83, 84 e 86).
 *
 * Comportamento e acessibilidade, nunca aparencia. O que estes testes travam:
 *
 *  - so aparece o que e valido AGORA — nao ha botao desabilitado e mudo;
 *  - mudar de situacao exige uma confirmacao explicita, nunca um toque solto;
 *  - a cor nunca carrega a informacao sozinha;
 *  - o texto diz a VERDADE sobre o que o sistema faz (item 64).
 */

const noop = async (): Promise<ServiceOrderActionState> => EMPTY_SERVICE_ORDER_STATE;

const liberarConserto: TransitionOption = {
  to: 'awaiting_repair',
  label: 'Liberar para conserto',
  requiresReason: false,
  hint: 'O parecer dispensou aprovacao do cliente.',
};

const cancelar: TransitionOption = {
  to: 'cancelled',
  label: 'Cancelar Ordem de Servico',
  requiresReason: true,
};

function renderWorkflow(overrides: Partial<Parameters<typeof WorkflowPanel>[0]> = {}) {
  return render(
    <WorkflowPanel
      serviceOrderId={overrides.serviceOrderId ?? 'os-1'}
      status={overrides.status ?? 'awaiting_technical_opinion'}
      version={overrides.version ?? 3}
      transitions={overrides.transitions ?? [liberarConserto]}
      canCancel={overrides.canCancel === undefined ? cancelar : overrides.canCancel}
      transitionAction={overrides.transitionAction ?? noop}
      cancelAction={overrides.cancelAction ?? noop}
    />,
  );
}

describe('situacao atual (item 86)', () => {
  it('mostra a situacao em TEXTO, nao apenas por cor', () => {
    renderWorkflow();
    expect(screen.getByText('Aguardando Parecer Tecnico')).toBeTruthy();
  });

  it('ordem encerrada nao oferece acao nenhuma, e diz por que', () => {
    renderWorkflow({ status: 'completed', transitions: [], canCancel: null });

    expect(screen.getByText(/esta encerrada e nao muda mais de situacao/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Liberar para conserto' })).toBeNull();
  });
});

describe('so o que e valido agora (item 79)', () => {
  it('desenha um botao por transicao recebida do servidor', () => {
    renderWorkflow({
      transitions: [
        liberarConserto,
        { to: 'awaiting_approval', label: 'Enviar para aprovacao', requiresReason: false },
      ],
    });

    expect(screen.getByRole('button', { name: 'Liberar para conserto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar para aprovacao' })).toBeTruthy();
  });

  it('nao existe botao desabilitado e mudo: o que nao pode, nao aparece', () => {
    const { container } = renderWorkflow({ transitions: [liberarConserto] });

    const desabilitados = container.querySelectorAll('button[disabled]');
    expect(desabilitados).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Finalizar' })).toBeNull();
  });

  it('sem permissao para cancelar, o botao de cancelar nao existe', () => {
    renderWorkflow({ canCancel: null });
    expect(screen.queryByRole('button', { name: /Cancelar Ordem/i })).toBeNull();
  });
});

describe('confirmacao explicita (itens 83 e 84)', () => {
  it('o clique ABRE um dialogo dizendo o que vai acontecer — nao muda nada direto', async () => {
    const user = userEvent.setup();
    renderWorkflow();

    await user.click(screen.getByRole('button', { name: 'Liberar para conserto' }));

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toBeTruthy();
    expect(screen.getByText(/A situacao passa de/i)).toBeTruthy();
    expect(screen.getByText('Aguardando Conserto')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy();
  });

  it('a versao lida viaja no formulario: quem perder a corrida recebe aviso (item 11)', async () => {
    const user = userEvent.setup();
    const { container } = renderWorkflow({ version: 7 });

    await user.click(screen.getByRole('button', { name: 'Liberar para conserto' }));

    const versao = container.querySelector('input[name="expectedVersion"]') as HTMLInputElement;
    expect(versao.value).toBe('7');
    const destino = container.querySelector('input[name="to"]') as HTMLInputElement;
    expect(destino.value).toBe('awaiting_repair');
  });

  it('transicao sem motivo obrigatorio nao pede motivo', async () => {
    const user = userEvent.setup();
    renderWorkflow();

    await user.click(screen.getByRole('button', { name: 'Liberar para conserto' }));
    expect(screen.queryByLabelText(/^Motivo/)).toBeNull();
  });

  it('cancelar EXIGE motivo escrito (item 53)', async () => {
    const user = userEvent.setup();
    renderWorkflow();

    await user.click(screen.getByRole('button', { name: 'Cancelar Ordem de Servico' }));

    const motivo = screen.getByLabelText(/Motivo do cancelamento/) as HTMLTextAreaElement;
    expect(motivo.required).toBe(true);
    expect(motivo.maxLength).toBe(300);
    expect(screen.getByText(/Nao e possivel desfazer/i)).toBeTruthy();
  });

  it('dá para voltar atras sem executar nada', async () => {
    const user = userEvent.setup();
    renderWorkflow();

    await user.click(screen.getByRole('button', { name: 'Liberar para conserto' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('o dialogo fecha sozinho quando a acao da certo', () => {
  it('confirmar com sucesso fecha o dialogo', async () => {
    const user = userEvent.setup();
    renderWorkflow({ transitionAction: noop });

    await user.click(screen.getByRole('button', { name: 'Liberar para conserto' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    // Deixar o dialogo aberto convidaria a repetir uma transicao ja aplicada.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('no ERRO o dialogo permanece aberto, com o aviso visivel', async () => {
    const user = userEvent.setup();
    const recusa = async (): Promise<ServiceOrderActionState> => ({
      error: 'Esta Ordem de Servico foi alterada por outra pessoa.',
      success: null,
    });
    renderWorkflow({ transitionAction: recusa });

    await user.click(screen.getByRole('button', { name: 'Liberar para conserto' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(screen.getByText(/alterada por outra pessoa/i)).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('cancelar com sucesso tambem fecha o dialogo', async () => {
    const user = userEvent.setup();
    renderWorkflow({ cancelAction: noop });

    await user.click(screen.getByRole('button', { name: 'Cancelar Ordem de Servico' }));
    await user.type(
      screen.getByLabelText(/Motivo do cancelamento/),
      'Cliente desistiu do conserto.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancelar a Ordem' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('tecnico responsavel (itens 26 a 29)', () => {
  it('lista apenas as pessoas recebidas e permite deixar sem responsavel', () => {
    render(
      <TechnicianPanel
        serviceOrderId="os-1"
        technicianId={null}
        members={[
          { id: 'u1', name: 'Ana Bancada' },
          { id: 'u2', name: 'Bruno Eletronica' },
        ]}
        action={noop}
      />,
    );

    const select = screen.getByLabelText(/Tecnico responsavel/) as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual([
      'Sem responsavel definido',
      'Ana Bancada',
      'Bruno Eletronica',
    ]);
  });

  it('explica o criterio de quem aparece — acesso a unidade, nao nome do papel (item 28)', () => {
    render(
      <TechnicianPanel serviceOrderId="os-1" technicianId={null} members={[]} action={noop} />,
    );
    expect(screen.getByText(/pessoas ativas com acesso a unidade/i)).toBeTruthy();
  });
});

describe('acompanhamento (item 39)', () => {
  it('e um campo de data, e deixar em branco tira a ordem das pendencias', () => {
    render(<FollowUpPanel serviceOrderId="os-1" followUpAt="2026-03-16" action={noop} />);

    const campo = screen.getByLabelText(/Proximo acompanhamento/) as HTMLInputElement;
    expect(campo.type).toBe('date');
    expect(campo.value).toBe('2026-03-16');
    expect(screen.getByText(/Deixe em branco para tirar esta ordem/i)).toBeTruthy();
  });
});

describe('Buscar Peca (itens 13 e 16)', () => {
  it('e texto livre, e diz que o catalogo chega com Estoque e Compras', () => {
    render(<PartPickupPanel serviceOrderId="os-1" action={noop} />);

    expect(screen.getByLabelText(/Qual peca e onde buscar/)).toBeTruthy();
    expect(screen.getByText(/catalogo de fornecedores e locais chega com Estoque/i)).toBeTruthy();
  });
});

describe('Informar Ordem Disponivel (itens 62 a 64 e 80)', () => {
  it('sem a preparacao concluida, explica a CONDICAO em vez de mostrar botao morto', () => {
    render(<NotifyCustomerPanel serviceOrderId="os-1" version={2} ready={false} action={noop} />);

    expect(
      screen.getByText(/Conclua a preparacao para entrega antes de informar o cliente/i),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Informar Ordem Disponivel/i })).toBeNull();
  });

  it('pronta, o texto diz a VERDADE: nada e enviado automaticamente (item 64)', () => {
    const { container } = render(
      <NotifyCustomerPanel serviceOrderId="os-1" version={2} ready action={noop} />,
    );

    expect(screen.getByRole('button', { name: 'Informar Ordem Disponivel' })).toBeTruthy();
    expect(
      screen.getByText(/envio automatico da mensagem ainda nao esta disponivel/i),
    ).toBeTruthy();

    // E NAO promete WhatsApp nem e-mail, que nao existem (Prompt 16).
    expect(container.textContent).not.toMatch(/whatsapp/i);
    expect(container.textContent).not.toMatch(/mensagem enviada/i);

    const versao = container.querySelector('input[name="expectedVersion"]') as HTMLInputElement;
    expect(versao.value).toBe('2');
  });
});
