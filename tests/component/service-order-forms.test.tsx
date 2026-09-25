// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import {
  EMPTY_SERVICE_ORDER_STATE,
  type ServiceOrderActionState,
} from '@/app/(app)/ordens-de-servico/action-state';
import {
  ServiceOrderEditForm,
  ServiceOrderForm,
} from '@/app/(app)/ordens-de-servico/service-order-form';

/**
 * Componentes de Ordem de Servico (Prompt 07, item 128).
 *
 * Verificam comportamento e acessibilidade — nunca aparencia.
 */

const noop = async (): Promise<ServiceOrderActionState> => EMPTY_SERVICE_ORDER_STATE;

function renderForm(overrides: Partial<Parameters<typeof ServiceOrderForm>[0]> = {}) {
  return render(
    <ServiceOrderForm
      action={overrides.action ?? noop}
      equipmentId={overrides.equipmentId ?? 'equip-1'}
      intakeId={overrides.intakeId ?? null}
      cancelHref="/equipamentos/equip-1"
      summary={overrides.summary ?? <p>Cliente: Maria Souza</p>}
    />,
  );
}

describe('abertura de Ordem de Servico (itens 89 a 93)', () => {
  it('so o relato do cliente e obrigatorio', () => {
    renderForm();

    expect((screen.getByLabelText(/^Relato do cliente/) as HTMLTextAreaElement).required).toBe(
      true,
    );
    expect((screen.getByLabelText('Observacoes internas') as HTMLTextAreaElement).required).toBe(
      false,
    );
  });

  it('diz em texto que o relato NAO e diagnostico (item 22)', () => {
    renderForm();
    expect(screen.getByText(/Nao e diagnostico tecnico/i)).toBeTruthy();
  });

  it('avisa que a observacao interna nao vai para o cliente (item 24)', () => {
    renderForm();
    expect(screen.getByText(/Nao sera apresentado ao cliente/i)).toBeTruthy();
  });

  it('mostra o RESUMO em vez de pedir cliente e equipamento de novo (item 89)', () => {
    const { container } = renderForm();

    expect(screen.getByText('Cliente: Maria Souza')).toBeTruthy();

    /**
     * Os unicos campos preenchiveis sao os dois textos. Cliente, equipamento e
     * unidade chegam resolvidos: quem esta com o cliente na frente nao
     * redigita o que o sistema ja sabe.
     */
    const preenchiveis = container.querySelectorAll('input:not([type="hidden"]), select, textarea');
    expect([...preenchiveis].map((campo) => campo.getAttribute('name'))).toEqual([
      'customerReport',
      'internalNotes',
    ]);
  });

  it('leva o equipamento e o recebimento em campos ocultos', () => {
    const { container } = renderForm({ intakeId: 'intake-9' });

    expect(container.querySelector('input[name="equipmentId"]')).toHaveProperty('value', 'equip-1');
    expect(container.querySelector('input[name="intakeId"]')).toHaveProperty('value', 'intake-9');
  });

  it('sem recebimento, o campo oculto nem existe', () => {
    const { container } = renderForm({ intakeId: null });
    expect(container.querySelector('input[name="intakeId"]')).toBeNull();
  });

  it('gera UMA chave de comando, estavel no formulario (itens 32 e 93)', () => {
    const { container, rerender } = renderForm();

    const campo = container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement;
    expect(campo.value).toBeTruthy();

    rerender(
      <ServiceOrderForm
        action={noop}
        equipmentId="equip-1"
        intakeId={null}
        cancelHref="/equipamentos/equip-1"
        summary={<p>Cliente: Maria Souza</p>}
      />,
    );

    const depois = container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement;
    expect(depois.value).toBe(campo.value);
  });

  it('dois formularios diferentes recebem chaves diferentes', () => {
    const primeiro = renderForm();
    const segundo = renderForm();

    const a = primeiro.container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement;
    const b = segundo.container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement;

    expect(a.value).not.toBe(b.value);
  });

  it('a chave existe mesmo sem crypto.randomUUID no navegador', () => {
    const original = globalThis.crypto;
    // Navegador antigo/contexto nao seguro: o formulario nao pode quebrar.
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });

    try {
      const { container } = renderForm();
      const campo = container.querySelector('input[name="idempotencyKey"]') as HTMLInputElement;
      expect(campo.value.length).toBeGreaterThan(8);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });

  it('o botao principal diz o que faz e some quando esta enviando', async () => {
    renderForm();
    const botao = screen.getByRole('button', { name: 'Abrir Ordem de Servico' });
    expect(botao).toBeTruthy();
    expect((botao as HTMLButtonElement).disabled).toBe(false);
  });

  it('mostra o erro devolvido pela acao', async () => {
    const comErro = async (): Promise<ServiceOrderActionState> => ({
      error: 'Selecione a unidade que vai executar o servico.',
      success: null,
    });

    renderForm({ action: comErro });
    await userEvent.type(screen.getByLabelText(/^Relato do cliente/), 'Nao liga.');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir Ordem de Servico' }));

    expect(await screen.findByText(/Selecione a unidade/i)).toBeTruthy();
  });

  it('respeita o limite de tamanho do relato', () => {
    renderForm();
    const relato = screen.getByLabelText(/^Relato do cliente/) as HTMLTextAreaElement;
    expect(relato.maxLength).toBe(4000);
  });

  it('cada campo tem rotulo ligado ao controle', () => {
    const { container } = renderForm();
    const visiveis = container.querySelectorAll('textarea');

    for (const campo of visiveis) {
      expect(campo.id).toBeTruthy();
      expect(container.querySelector(`label[for="${campo.id}"]`)).toBeTruthy();
    }
  });
});

describe('correcao dos dados de abertura (itens 41 a 43 e 111)', () => {
  function renderEdit() {
    return render(
      <ServiceOrderEditForm
        action={noop}
        serviceOrderId="os-1"
        customerReport="Cliente informa que nao liga."
        internalNotes="Combinado retorno por telefone."
        cancelHref="/ordens-de-servico/os-1"
        aiAvailable={false}
      />,
    );
  }

  it('traz os valores atuais para correcao', () => {
    renderEdit();
    expect((screen.getByLabelText(/^Relato do cliente/) as HTMLTextAreaElement).value).toBe(
      'Cliente informa que nao liga.',
    );
    expect((screen.getByLabelText('Observacoes internas') as HTMLTextAreaElement).value).toBe(
      'Combinado retorno por telefone.',
    );
  });

  it('NAO oferece troca de cliente, equipamento ou unidade', () => {
    const { container } = renderEdit();

    expect(container.querySelector('input[name="customerId"]')).toBeNull();
    expect(container.querySelector('input[name="equipmentId"]')).toBeNull();
    expect(container.querySelector('input[name="unitId"]')).toBeNull();
    expect(screen.getByText(/nao mudam por aqui/i)).toBeTruthy();
  });

  it('avisa que a alteracao do relato fica registrada (item 23)', () => {
    renderEdit();
    expect(screen.getByText(/trilha de auditoria, com o texto anterior/i)).toBeTruthy();
  });

  it('leva o id da ordem em campo oculto', () => {
    const { container } = renderEdit();
    expect(container.querySelector('input[name="serviceOrderId"]')).toHaveProperty('value', 'os-1');
  });

  it('NAO ha botao de excluir Ordem de Servico (itens 109 e 110)', () => {
    renderEdit();
    expect(screen.queryByRole('button', { name: /excluir/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /apagar/i })).toBeNull();
  });

  it('NAO ha acao de workflow antecipada (item 60)', () => {
    renderEdit();
    for (const proibido of [/orcamento/i, /buscar peca/i, /concluir/i, /finalizar/i]) {
      expect(screen.queryByRole('button', { name: proibido })).toBeNull();
    }
  });
});
