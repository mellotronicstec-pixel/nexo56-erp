// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import { CustomerForm, EMPTY_FORM_VALUES } from '@/app/(app)/clientes/customer-form';
import { EMPTY_CUSTOMER_STATE, type CustomerActionState } from '@/app/(app)/clientes/action-state';

/**
 * Formulario de cliente (Prompt 05, item 60).
 *
 * Testa o que muda de verdade na tela: campos que aparecem por tipo, contatos
 * repetiveis e o aviso de duplicidade. Nao testa aparencia.
 */

const noop = async (): Promise<CustomerActionState> => EMPTY_CUSTOMER_STATE;

function renderForm(overrides: Partial<Parameters<typeof CustomerForm>[0]> = {}) {
  return render(
    <CustomerForm
      action={overrides.action ?? noop}
      initial={overrides.initial ?? EMPTY_FORM_VALUES}
      submitLabel={overrides.submitLabel ?? 'Cadastrar cliente'}
      cancelHref="/clientes"
    />,
  );
}

describe('campos por tipo de pessoa (item 7)', () => {
  it('pessoa fisica mostra CPF e nascimento, e esconde o que e de empresa', () => {
    renderForm();

    expect(screen.getByLabelText(/^CPF/)).toBeTruthy();
    expect(screen.getByLabelText(/^Nome completo/)).toBeTruthy();
    expect(screen.getByLabelText('Data de nascimento')).toBeTruthy();

    expect(screen.queryByLabelText('Nome fantasia')).toBeNull();
    expect(screen.queryByLabelText('Inscricao estadual')).toBeNull();
  });

  it('trocar para pessoa juridica troca os campos, sem recarregar', async () => {
    renderForm();

    await userEvent.selectOptions(screen.getByLabelText(/Tipo de cliente/), 'company');

    expect(screen.getByLabelText(/^Razao social/)).toBeTruthy();
    expect(screen.getByLabelText('Nome fantasia')).toBeTruthy();
    expect(screen.getByLabelText('Inscricao estadual')).toBeTruthy();
    expect(screen.getByLabelText(/^CNPJ/)).toBeTruthy();

    expect(screen.queryByLabelText('Data de nascimento')).toBeNull();
  });

  it('na edicao o tipo fica travado — PF nao vira PJ (item 33)', () => {
    renderForm({
      initial: { ...EMPTY_FORM_VALUES, customerId: 'abc', name: 'Joao' },
      submitLabel: 'Salvar alteracoes',
    });

    expect((screen.getByLabelText(/Tipo de cliente/) as HTMLSelectElement).disabled).toBe(true);
  });
});

describe('documento (item 6)', () => {
  it('o documento NAO e obrigatorio', () => {
    renderForm();
    const documento = screen.getByLabelText(/^CPF/) as HTMLInputElement;
    expect(documento.required).toBe(false);
  });

  it('a dica deixa claro que pode ficar para depois', () => {
    renderForm();
    expect(screen.getByText('Opcional. Pode ser informado depois.')).toBeTruthy();
  });
});

describe('contatos repetiveis (itens 10 e 47)', () => {
  /**
   * As consultas ficam DENTRO da secao "Contatos": o endereco tambem tem um
   * campo "Numero", e buscar na pagina inteira acharia os dois. A secao so e
   * localizavel assim porque tem nome acessivel — o que este escopo, de
   * quebra, verifica.
   */
  const contatos = () => within(screen.getByRole('region', { name: 'Contatos' }));

  it('comeca com uma linha de contato', () => {
    renderForm();
    expect(contatos().getAllByLabelText(/^Numero/)).toHaveLength(1);
  });

  it('adiciona contato pelo teclado', async () => {
    renderForm();

    await userEvent.click(screen.getByRole('button', { name: /Adicionar contato/ }));
    expect(contatos().getAllByLabelText(/^Numero/)).toHaveLength(2);
  });

  it('remover tem NOME ACESSIVEL que identifica a linha', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: /Adicionar contato/ }));

    expect(screen.getByRole('button', { name: 'Remover contato 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remover contato 2' })).toBeTruthy();
  });

  it('remove a linha certa', async () => {
    renderForm();
    await userEvent.click(screen.getByRole('button', { name: /Adicionar contato/ }));

    const campos = contatos().getAllByLabelText(/^Numero/) as HTMLInputElement[];
    await userEvent.type(campos[0]!, '1111111111');
    await userEvent.type(campos[1]!, '2222222222');

    await userEvent.click(screen.getByRole('button', { name: 'Remover contato 1' }));

    const restantes = contatos().getAllByLabelText(/^Numero/) as HTMLInputElement[];
    expect(restantes).toHaveLength(1);
    expect(restantes[0]!.value).toBe('2222222222');
  });

  it('a unica linha nao pode ser removida — o cadastro exige um contato', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: /Remover contato/ })).toBeNull();
  });

  it('trocar o tipo do contato troca o rotulo do campo', async () => {
    renderForm();

    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'email');
    expect(screen.getByLabelText(/^Endereco de e-mail/)).toBeTruthy();
    // WhatsApp so existe para telefone (item 13).
    expect(screen.queryByRole('checkbox', { name: /WhatsApp/ })).toBeNull();
  });

  it('telefone oferece a marcacao de WhatsApp', () => {
    renderForm();
    expect(screen.getByRole('checkbox', { name: /WhatsApp/ })).toBeTruthy();
  });
});

describe('duplicidade (item 20)', () => {
  it('quando o documento ja existe, oferece o atalho para o cliente existente', async () => {
    const comDuplicado = async (): Promise<CustomerActionState> => ({
      error: 'Ja existe um cliente com este documento nesta empresa.',
      success: null,
      duplicate: { id: 'cliente-1', name: 'Joao da Silva' },
    });

    renderForm({ action: comDuplicado });

    await userEvent.click(screen.getByRole('button', { name: /Cadastrar cliente/ }));

    const link = await screen.findByRole('link', { name: /Abrir o cadastro de Joao da Silva/ });
    expect(link.getAttribute('href')).toBe('/clientes/cliente-1');
  });
});

describe('observacoes internas (item 17)', () => {
  it('deixa explicito que o cliente nao ve o campo', () => {
    renderForm();
    expect(screen.getByText('Uso interno da equipe. O cliente nao ve este campo.')).toBeTruthy();
  });
});

describe('CEP (item 16)', () => {
  it('nao promete busca automatica que nao existe', () => {
    renderForm();
    expect(screen.getByText(/Busca automatica por CEP ainda nao esta disponivel/)).toBeTruthy();
  });
});
