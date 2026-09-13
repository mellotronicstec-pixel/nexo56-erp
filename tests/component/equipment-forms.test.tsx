// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import { EquipmentForm } from '@/app/(app)/equipamentos/equipment-form';
import { IntakeForm } from '@/app/(app)/recebimentos/intake-form';
import {
  EMPTY_EQUIPMENT_STATE,
  type EquipmentActionState,
} from '@/app/(app)/equipamentos/action-state';

/**
 * Componentes de Equipamentos e Recebimento (Prompt 06, item 112).
 *
 * Verificam comportamento e acessibilidade — nunca aparencia.
 */

const noop = async (): Promise<EquipmentActionState> => EMPTY_EQUIPMENT_STATE;

const baseEquipment = {
  customerId: 'cliente-1',
  kind: '',
  brand: '',
  model: '',
  serial: '',
  voltage: 'unknown' as const,
  notes: '',
};

function renderEquipmentForm(overrides: Partial<Parameters<typeof EquipmentForm>[0]> = {}) {
  return render(
    <EquipmentForm
      action={overrides.action ?? noop}
      initial={overrides.initial ?? baseEquipment}
      customerName="Joao da Silva"
      submitLabel="Cadastrar equipamento"
      cancelHref="/clientes/cliente-1"
      labelRecognitionAvailable={overrides.labelRecognitionAvailable ?? false}
    />,
  );
}

describe('formulario de equipamento (itens 9 e 56)', () => {
  it('SO o tipo e obrigatorio — etiqueta ilegivel nao impede o cadastro', () => {
    renderEquipmentForm();

    expect((screen.getByLabelText(/^Tipo de equipamento/) as HTMLInputElement).required).toBe(true);
    expect((screen.getByLabelText('Marca') as HTMLInputElement).required).toBe(false);
    expect((screen.getByLabelText('Modelo') as HTMLInputElement).required).toBe(false);
    expect((screen.getByLabelText('Numero de serie') as HTMLInputElement).required).toBe(false);
  });

  it('a dica do serial diz que ele pode faltar', () => {
    renderEquipmentForm();
    expect(screen.getByText(/Etiqueta ilegivel ou ausente nao impede o cadastro/)).toBeTruthy();
  });

  it('oferece todas as tensoes, incluindo bivolt e as duas ausencias', async () => {
    renderEquipmentForm();

    const select = screen.getByLabelText(/^Tensao/);
    const opcoes = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(opcoes).toContain('Bivolt');
    expect(opcoes).toContain('Nao se aplica');
    expect(opcoes).toContain('Nao identificada');
  });

  it('o tipo tem sugestoes sem virar lista fechada', () => {
    const { container } = renderEquipmentForm();

    const input = screen.getByLabelText(/^Tipo de equipamento/) as HTMLInputElement;
    expect(input.getAttribute('list')).toBe('tipos-equipamento');
    // Continua sendo campo de texto: da para digitar o que a lista nao previu.
    expect(input.tagName).toBe('INPUT');
    expect(container.querySelector('datalist#tipos-equipamento')).toBeTruthy();
  });
});

describe('leitura de etiqueta indisponivel (itens 40 e 41)', () => {
  it('EXPLICA a indisponibilidade em portugues, sem prometer nada', () => {
    renderEquipmentForm({ labelRecognitionAvailable: false });

    expect(screen.getByText(/Leitura automatica de etiqueta indisponivel/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Fotografar etiqueta/ })).toBeNull();
  });

  it('mesmo indisponivel, TODOS os campos continuam preenchiveis', async () => {
    renderEquipmentForm({ labelRecognitionAvailable: false });

    const marca = screen.getByLabelText('Marca') as HTMLInputElement;
    await userEvent.type(marca, 'Yamaha');
    expect(marca.value).toBe('Yamaha');
  });

  it('quando disponivel, oferece a camera e deixa claro que ha revisao', () => {
    renderEquipmentForm({ labelRecognitionAvailable: true });

    expect(screen.getByRole('button', { name: /Fotografar etiqueta/ })).toBeTruthy();
    expect(screen.getByText(/Voce revisa os dados antes de salvar/)).toBeTruthy();
  });

  it('o input de camera pede a traseira, mas aceita arquivo', () => {
    const { container } = renderEquipmentForm({ labelRecognitionAvailable: true });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(input.getAttribute('aria-label')).toBe('Foto da etiqueta');
  });
});

describe('aviso de duplicidade (item 55)', () => {
  it('lista os parecidos e permite confirmar em vez de bloquear', async () => {
    const comParecidos = async (): Promise<EquipmentActionState> => ({
      error: 'Encontramos equipamentos parecidos. Confira antes de cadastrar outro.',
      success: null,
      similar: [{ id: 'eq-1', title: 'Yamaha RX-V385', customerName: 'Joao da Silva' }],
    });

    renderEquipmentForm({ action: comParecidos });

    await userEvent.click(screen.getByRole('button', { name: /Cadastrar equipamento/ }));

    const link = await screen.findByRole('link', { name: 'Yamaha RX-V385' });
    expect(link.getAttribute('href')).toBe('/equipamentos/eq-1');
    expect(screen.getByText(/envie novamente para confirmar/i)).toBeTruthy();
  });
});

describe('formulario de recebimento (itens 18, 19 e 83)', () => {
  function renderIntake() {
    return render(
      <IntakeForm
        action={noop}
        equipmentId="eq-1"
        equipmentTitle="Yamaha RX-V385"
        customerName="Joao da Silva"
        unitName="Unidade Centro"
        cancelHref="/equipamentos/eq-1"
      />,
    );
  }

  it('mostra em qual unidade o recebimento sera registrado', () => {
    renderIntake();
    expect(screen.getByText('Unidade Centro')).toBeTruthy();
  });

  it('o checklist de estado tem todas as condicoes, com rotulo clicavel', () => {
    renderIntake();
    const secao = within(screen.getByRole('region', { name: 'Estado na entrada' }));

    expect(secao.getByRole('checkbox', { name: /Riscos/ })).toBeTruthy();
    expect(secao.getByRole('checkbox', { name: /Sinais de oxidacao/ })).toBeTruthy();
    expect(secao.getByRole('checkbox', { name: /Equipamento desmontado/ })).toBeTruthy();
  });

  it('marcar uma condicao funciona pelo TEXTO, nao so pela caixinha', async () => {
    renderIntake();
    const secao = within(screen.getByRole('region', { name: 'Estado na entrada' }));

    const checkbox = secao.getByRole('checkbox', { name: /Trincas/ }) as HTMLInputElement;
    await userEvent.click(secao.getByText('Trincas'));
    expect(checkbox.checked).toBe(true);
  });

  it('o checklist NAO limita: ha campo livre para o que ele nao previu', () => {
    renderIntake();
    expect(screen.getByLabelText(/Outras observacoes sobre o estado fisico/)).toBeTruthy();
  });

  it('deixa explicito que isto nao e diagnostico tecnico (item 20)', () => {
    renderIntake();
    expect(screen.getByText(/NAO e diagnostico tecnico/i)).toBeTruthy();
  });

  it('acessorios comecam vazios e sao adicionados por sugestao', async () => {
    renderIntake();
    const secao = within(screen.getByRole('region', { name: 'Acessorios entregues' }));

    expect(secao.queryByLabelText(/^Acessorio 1/)).toBeNull();

    await userEvent.click(secao.getByRole('button', { name: 'Controle remoto' }));

    const campo = secao.getByLabelText(/^Acessorio 1/) as HTMLInputElement;
    expect(campo.value).toBe('Controle remoto');
  });

  it('acessorio tem quantidade INTEIRA', async () => {
    renderIntake();
    const secao = within(screen.getByRole('region', { name: 'Acessorios entregues' }));

    await userEvent.click(secao.getByRole('button', { name: 'Bateria' }));

    const quantidade = secao.getByLabelText(/^Qtd/) as HTMLInputElement;
    expect(quantidade.type).toBe('number');
    expect(quantidade.min).toBe('1');
    expect(quantidade.value).toBe('1');
  });

  it('remover acessorio tem NOME ACESSIVEL que identifica a linha', async () => {
    renderIntake();
    const secao = within(screen.getByRole('region', { name: 'Acessorios entregues' }));

    await userEvent.click(secao.getByRole('button', { name: 'Fonte' }));
    expect(secao.getByRole('button', { name: 'Remover acessorio 1' })).toBeTruthy();
  });

  it('o cabo de forca tem tres respostas, nao um sim/nao', () => {
    renderIntake();
    const select = screen.getByLabelText(/Cabo de forca entregue/);
    const opcoes = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);

    expect(opcoes).toEqual(['Sim, entregue', 'Nao entregue', 'Nao se aplica']);
  });
});
