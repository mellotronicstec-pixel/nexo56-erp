// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import {
  Badge,
  Breadcrumb,
  Button,
  Checkbox,
  FormField,
  IconButton,
  Input,
  Modal,
  Pagination,
  PasswordInput,
  SearchField,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/design-system/components';

/**
 * Testes de componente (Prompt 04, item 120).
 *
 * Cobrem o que de fato quebra em silencio: ligacao de rotulo, estado
 * desabilitado, foco, teclado e nome acessivel. NAO testam aparencia — classe
 * CSS muda a toda hora e um teste preso a `bg-brand-500` so gera manutencao.
 */

describe('Button', () => {
  it('dispara o clique e mostra o rotulo', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Salvar</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('loading desabilita e anuncia ocupado — impede duplo envio', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Salvar
      </Button>,
    );

    const button = screen.getByRole('button', { name: /Salvar/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled nao dispara acao', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Excluir
      </Button>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('e alcancavel por teclado e aciona com Enter', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Confirmar</Button>);

    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirmar' }));

    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('IconButton', () => {
  it('expoe nome acessivel mesmo sem texto visivel', () => {
    render(
      <IconButton label="Abrir menu">
        <svg />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeTruthy();
  });
});

describe('FormField', () => {
  it('liga rotulo ao controle', () => {
    render(
      <FormField id="nome" label="Nome">
        {(props) => <Input {...props} />}
      </FormField>,
    );

    const input = screen.getByLabelText('Nome');
    expect(input.getAttribute('id')).toBe('nome');
  });

  it('liga erro e dica por aria-describedby, e marca invalido', () => {
    render(
      <FormField
        id="email"
        label="E-mail"
        hint="Usado para entrar."
        error="Informe um e-mail valido."
      >
        {(props) => <Input {...props} />}
      </FormField>,
    );

    const input = screen.getByLabelText('E-mail');
    const describedBy = input.getAttribute('aria-describedby') ?? '';

    expect(describedBy).toContain('email-error');
    expect(describedBy).toContain('email-hint');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // O erro tambem e TEXTO: nao depende so da cor.
    expect(screen.getByText('Informe um e-mail valido.')).toBeTruthy();
  });

  it('sem erro, nao marca o campo como invalido', () => {
    render(
      <FormField id="nome2" label="Nome">
        {(props) => <Input {...props} />}
      </FormField>,
    );

    expect(screen.getByLabelText('Nome').getAttribute('aria-invalid')).toBeNull();
  });

  it('campo obrigatorio e anunciado', () => {
    render(
      <FormField id="senha" label="Senha" required>
        {(props) => <Input {...props} />}
      </FormField>,
    );

    expect(screen.getByLabelText(/Senha/).getAttribute('aria-required')).toBe('true');
  });
});

describe('PasswordInput', () => {
  it('alterna a visibilidade e anuncia o estado', async () => {
    render(<PasswordInput aria-label="Senha" defaultValue="frase-secreta" />);

    const input = screen.getByLabelText('Senha');
    expect(input.getAttribute('type')).toBe('password');

    const toggle = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    await userEvent.click(toggle);

    expect(screen.getByLabelText('Senha').getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Ocultar senha' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});

describe('Checkbox', () => {
  it('alterna clicando no TEXTO do rotulo', async () => {
    render(<Checkbox label="Encerrar as outras sessoes" />);

    const checkbox = screen.getByRole('checkbox', { name: /Encerrar as outras sessoes/ });
    expect((checkbox as HTMLInputElement).checked).toBe(false);

    await userEvent.click(screen.getByText('Encerrar as outras sessoes'));
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });

  it('desabilitado nao alterna', async () => {
    render(<Checkbox label="Opcao bloqueada" disabled />);

    const checkbox = screen.getByRole('checkbox', { name: /Opcao bloqueada/ });
    await userEvent.click(checkbox).catch(() => undefined);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });
});

describe('Modal', () => {
  it('fechado nao renderiza nada', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Confirmar">
        conteudo
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('aberto e um dialogo modal nomeado pelo titulo', () => {
    render(
      <Modal open onClose={() => {}} title="Inativar usuario" description="Acao reversivel.">
        conteudo
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('heading', { name: 'Inativar usuario' })).toBeTruthy();
  });

  it('Esc fecha', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Confirmar">
        conteudo
      </Modal>,
    );

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('o botao de fechar tem nome acessivel', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Confirmar">
        conteudo
      </Modal>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Table', () => {
  it('tem legenda para leitor de tela e cabecalhos com escopo', () => {
    render(
      <Table caption="Usuarios desta empresa">
        <THead>
          <TR>
            <TH>Nome</TH>
            <TH srOnly>Acoes</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>Ana</TD>
            <TD>-</TD>
          </TR>
        </TBody>
      </Table>,
    );

    expect(screen.getByRole('table', { name: 'Usuarios desta empresa' })).toBeTruthy();
    const header = screen.getByRole('columnheader', { name: 'Nome' });
    expect(header.getAttribute('scope')).toBe('col');
    // Coluna de acoes: sem rotulo visivel, mas nomeada.
    expect(screen.getByRole('columnheader', { name: 'Acoes' })).toBeTruthy();
  });
});

describe('Breadcrumb', () => {
  it('marca o ultimo item como pagina atual e nao o torna link', () => {
    render(
      <Breadcrumb
        items={[{ label: 'Administracao', href: '/administracao' }, { label: 'Usuarios' }]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Administracao' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Usuarios' })).toBeNull();
    expect(screen.getByText('Usuarios').getAttribute('aria-current')).toBe('page');
  });
});

describe('Pagination', () => {
  it('nao aparece quando ha uma unica pagina', () => {
    const { container } = render(<Pagination page={1} pageCount={1} hrefFor={(p) => `?p=${p}`} />);
    expect(container.firstChild).toBeNull();
  });

  it('desabilita "Anterior" na primeira pagina', () => {
    render(<Pagination page={1} pageCount={3} hrefFor={(p) => `?p=${p}`} />);

    expect(screen.queryByRole('link', { name: /Anterior/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Proxima/ })).toBeTruthy();
  });
});

describe('SearchField', () => {
  it('mantem rotulo acessivel mesmo oculto visualmente', () => {
    render(<SearchField id="busca" label="Buscar usuario" />);

    const field = screen.getByLabelText('Buscar usuario');
    expect(field.getAttribute('type')).toBe('search');
  });
});

describe('Badge', () => {
  it('renderiza o texto — estado nunca depende so de cor', () => {
    render(<Badge tone="success">ativo</Badge>);
    expect(screen.getByText('ativo')).toBeTruthy();
  });
});
