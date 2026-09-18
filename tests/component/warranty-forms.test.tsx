// @vitest-environment happy-dom
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import './setup-dom';
import { EMPTY_WARRANTY_STATE, type WarrantyActionState } from '@/app/(app)/garantias/action-state';
import {
  IssueCertificateForm,
  LifecycleForm,
  RecordCostForm,
  ReclassifyForm,
  RegisterReturnForm,
} from '@/app/(app)/garantias/[warrantyId]/warranty-forms';
import { PolicyForm, PolicyStatusForm } from '@/app/(app)/garantias/politicas/policy-forms';
import { WarrantySection } from '@/app/(app)/ordens-de-servico/[serviceOrderId]/warranty-section';

/**
 * INTERFACE DE GARANTIAS (Prompt 13, itens 85 a 91 e 105).
 *
 * COMPORTAMENTO E ACESSIBILIDADE, nunca aparencia. O que estes testes travam e
 * exatamente o que separa uma tela de garantia confiavel de um cadastro
 * bonito:
 *
 *   - o formulario NAO decide vigencia nem estado inicial da OS;
 *   - a recusa e DITA na tela, com o motivo, em vez de sumir com o botao;
 *   - a chave de intencao existe, para que duplo clique nao vire duas OS;
 *   - quem nao pode fazer NAO VE o campo, em vez de ve-lo cinza;
 *   - nenhuma tela promete PDF, WhatsApp, cobranca automatica ou compra de
 *     peca.
 */

const noop = async (): Promise<WarrantyActionState> => EMPTY_WARRANTY_STATE;

const POLITICA = {
  id: 'pol-1',
  name: 'Garantia padrao de bancada',
  type: 'internal',
  durationAmount: 3,
  durationUnit: 'months',
  coverageSummary: 'Mao de obra do reparo executado.',
  exclusions: 'Mau uso, queda e liquido.',
  terms: 'Apresentar o certificado.',
  status: 'active',
  version: 4,
};

describe('Registrar retorno em garantia', () => {
  it('leva a chave de intencao, para que dois cliques nao virem duas Ordens de Servico', () => {
    const { container } = render(
      <RegisterReturnForm warrantyId="gar-1" action={noop} enforceable impediment={null} />,
    );

    const chave = container.querySelector('input[name="commandKey"]');
    expect(chave).not.toBeNull();
    expect((chave as HTMLInputElement).value.length).toBeGreaterThan(20);
  });

  it('nao oferece campo de vigencia, de estado inicial nem de classificacao', () => {
    const { container } = render(
      <RegisterReturnForm warrantyId="gar-1" action={noop} enforceable impediment={null} />,
    );

    /**
     * A EXCECAO DE ESTADO INICIAL NAO E EXPLORAVEL PELA TELA (itens 27 e 110).
     * Se o formulario tivesse um campo `status`, qualquer pessoa com o
     * inspetor aberto abriria OS normal ja em Aguardando Conserto.
     */
    for (const campo of ['status', 'classification', 'startsOn', 'endsOn', 'wasEnforceable']) {
      expect(container.querySelector(`[name="${campo}"]`)).toBeNull();
    }
  });

  it('DIZ por que a garantia nao vale, em vez de esconder o formulario', () => {
    render(
      <RegisterReturnForm
        warrantyId="gar-1"
        action={noop}
        enforceable={false}
        impediment="Esta garantia terminou em 01/03/2026."
      />,
    );

    expect(screen.getByText(/terminou em 01\/03\/2026/)).toBeTruthy();
    /** O registro continua possivel: recusa registrada tambem e historico. */
    expect(screen.getByRole('button', { name: /registrar retorno/i })).toBeTruthy();
  });

  it('oferece "ainda nao sei" como avaliacao real de cobertura', () => {
    render(<RegisterReturnForm warrantyId="gar-1" action={noop} enforceable impediment={null} />);

    const select = screen.getByLabelText(/avaliacao de cobertura/i) as HTMLSelectElement;
    const valores = [...select.options].map((option) => option.value);
    expect(valores).toContain('undetermined');
    expect(select.value).toBe('undetermined');
  });

  it('avisa que a Ordem de Servico sera NOVA e que a original nao reabre', () => {
    render(<RegisterReturnForm warrantyId="gar-1" action={noop} enforceable impediment={null} />);
    expect(screen.getByText(/original nao reabre/i)).toBeTruthy();
  });
});

describe('Reclassificar a Ordem de Servico de garantia', () => {
  it('exige motivo com tamanho minimo e leva a versao esperada', () => {
    const { container } = render(
      <ReclassifyForm serviceOrderId="os-1" warrantyId="gar-1" expectedVersion={7} action={noop} />,
    );

    const motivo = container.querySelector('textarea[name="reason"]') as HTMLTextAreaElement;
    expect(motivo.required).toBe(true);
    expect(Number(motivo.minLength)).toBeGreaterThanOrEqual(15);

    const versao = container.querySelector('input[name="expectedVersion"]') as HTMLInputElement;
    expect(versao.value).toBe('7');
  });

  it('avisa que avisar o cliente continua sendo ato humano', () => {
    render(
      <ReclassifyForm serviceOrderId="os-1" warrantyId="gar-1" expectedVersion={1} action={noop} />,
    );
    expect(screen.getByText(/avisado por uma pessoa/i)).toBeTruthy();
  });
});

describe('Encerrar a garantia', () => {
  it('cancelar e revogar contam historias diferentes', () => {
    const { unmount } = render(<LifecycleForm warrantyId="gar-1" kind="cancel" action={noop} />);
    expect(screen.getByText(/nao deveria existir/i)).toBeTruthy();
    unmount();

    render(<LifecycleForm warrantyId="gar-1" kind="revoke" action={noop} />);
    expect(screen.getByText(/de agora em diante/i)).toBeTruthy();
    expect(screen.getByText(/continuam no historico/i)).toBeTruthy();
  });
});

describe('Custos da garantia', () => {
  it('diz que nao cria lancamento financeiro nem cobranca', () => {
    render(
      <RecordCostForm
        warrantyId="gar-1"
        returns={[{ id: 'ret-1', label: '10/03/2026 · OS 42' }]}
        action={noop}
      />,
    );

    expect(screen.getByText(/custo interno da loja, nao preco ao cliente/i)).toBeTruthy();
    /** Nenhum campo cria titulo, conta ou forma de pagamento. */
    expect(screen.queryByLabelText(/conta/i)).toBeNull();
    expect(screen.queryByLabelText(/forma de pagamento/i)).toBeNull();
  });
});

describe('Certificado', () => {
  it('nao promete PDF em lugar nenhum do formulario', () => {
    const { container } = render(
      <IssueCertificateForm warrantyId="gar-1" existing={false} action={noop} />,
    );
    expect(container.textContent?.toLowerCase()).not.toContain('pdf');
  });

  it('gerar de novo e dito como "gerar novamente", nao como "reemitir"', () => {
    render(<IssueCertificateForm warrantyId="gar-1" existing action={noop} />);
    expect(screen.getByRole('button', { name: /gerar novamente/i })).toBeTruthy();
  });
});

describe('Politicas de garantia', () => {
  it('diz na tela que editar a politica nao mexe em garantia ja emitida', () => {
    render(<PolicyForm policy={POLITICA} action={noop} />);
    expect(screen.getByText(/NAO altera nenhuma garantia ja emitida/i)).toBeTruthy();
  });

  it('leva a versao esperada, para nao sobrescrever o trabalho de outra pessoa', () => {
    const { container } = render(<PolicyForm policy={POLITICA} action={noop} />);
    const versao = container.querySelector('input[name="expectedVersion"]') as HTMLInputElement;
    expect(versao.value).toBe('4');
  });

  it('a politica nova nao leva versao esperada — nao ha o que sobrescrever', () => {
    const { container } = render(<PolicyForm action={noop} />);
    expect(container.querySelector('input[name="expectedVersion"]')).toBeNull();
  });

  it('desativar e reativar sao o mesmo botao com valores opostos', () => {
    const { container, unmount } = render(
      <PolicyStatusForm policyId="pol-1" status="active" action={noop} />,
    );
    expect((container.querySelector('input[name="status"]') as HTMLInputElement).value).toBe(
      'inactive',
    );
    unmount();

    const segunda = render(<PolicyStatusForm policyId="pol-1" status="inactive" action={noop} />);
    expect(
      (segunda.container.querySelector('input[name="status"]') as HTMLInputElement).value,
    ).toBe('active');
  });
});

describe('Secao de Garantias na ficha da Ordem de Servico', () => {
  const base: ComponentProps<typeof WarrantySection> = {
    serviceOrderId: 'os-1',
    equipmentId: 'eq-1',
    version: 3,
    classification: 'standard',
    origin: null,
    warranties: [],
    returnsFromThisOrder: [],
    policies: [POLITICA],
    canIssue: true,
    canReclassify: true,
    canIssueHere: true,
    issueBlockedReason: null,
    issueAction: noop,
    reclassifyAction: noop,
  };

  it('esconde o formulario de emissao enquanto a OS nao estiver concluida, dizendo por que', () => {
    render(
      <WarrantySection
        {...base}
        canIssueHere={false}
        issueBlockedReason="Conclua a Ordem de Servico primeiro."
      />,
    );

    expect(screen.getByText(/conclua a ordem de servico primeiro/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /emitir garantia/i })).toBeNull();
  });

  it('quem nao pode emitir NAO VE o bloco, em vez de ve-lo desabilitado', () => {
    render(<WarrantySection {...base} canIssue={false} />);
    expect(screen.queryByRole('button', { name: /emitir garantia/i })).toBeNull();
    expect(screen.queryByText(/emitir garantia/i)).toBeNull();
  });

  it('a OS de garantia diz que nasceu de um retorno e que a original nao reabriu', () => {
    render(
      <WarrantySection
        {...base}
        classification="warranty_internal"
        origin={{
          warrantyId: 'gar-1',
          warrantyNumber: 12,
          originalServiceOrderId: 'os-0',
          originalNumber: 41,
        }}
      />,
    );

    expect(screen.getByText(/NAO foi reaberta/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /GAR 000012/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /OS 41/ })).toBeTruthy();
  });

  it('a reclassificacao so aparece na OS de garantia, e so para quem pode', () => {
    const origem = {
      warrantyId: 'gar-1',
      warrantyNumber: 12,
      originalServiceOrderId: 'os-0',
      originalNumber: 41,
    };

    const { unmount } = render(<WarrantySection {...base} classification="standard" />);
    expect(screen.queryByText(/reclassificar/i)).toBeNull();
    unmount();

    const semPermissao = render(
      <WarrantySection
        {...base}
        classification="warranty_internal"
        origin={origem}
        canReclassify={false}
      />,
    );
    expect(screen.queryByText(/reclassificar/i)).toBeNull();
    semPermissao.unmount();

    render(<WarrantySection {...base} classification="warranty_internal" origin={origem} />);
    expect(screen.getByText(/nao esta coberto: reclassificar/i)).toBeTruthy();
  });

  it('a cobertura parcial explica o que acontece com defeito fora da lista', async () => {
    const user = userEvent.setup();
    render(<WarrantySection {...base} />);

    await user.click(screen.getByLabelText(/cobre apenas os itens listados/i));

    expect(screen.getByText(/nao gera conserto gratuito, mesmo dentro do prazo/i)).toBeTruthy();
  });

  it('o formulario de emissao nao oferece campo de estado, classificacao nem vigencia final', () => {
    const { container } = render(<WarrantySection {...base} />);

    for (const campo of ['status', 'classification', 'endsOn', 'number']) {
      expect(container.querySelector(`[name="${campo}"]`)).toBeNull();
    }
  });

  it('nenhuma tela promete WhatsApp, PDF, cobranca automatica ou compra de peca', () => {
    const { container } = render(<WarrantySection {...base} />);
    const texto = (container.textContent ?? '').toLowerCase();

    for (const promessa of ['whatsapp', 'sms', 'pdf', 'nota fiscal', 'comprar peca']) {
      expect(texto).not.toContain(promessa);
    }
  });
});
