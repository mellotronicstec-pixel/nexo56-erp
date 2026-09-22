import { describe, expect, it } from 'vitest';
import {
  CHANNEL_CONTACT_TYPE,
  CHANNEL_LABEL,
  COMMUNICATION_CHANNELS,
  DELIVERY_ERRORS,
  DELIVERY_ERROR_LABEL,
  MESSAGE_ORIGINS,
  MESSAGE_PURPOSES,
  MESSAGE_STATUSES,
  MESSAGE_STATUS_LABEL,
  canCancel,
  canRetry,
  channelUsesSubject,
  explainNotRetryable,
  isCommunicationChannel,
  isDeliveryError,
  isMessageStatus,
  isRetryableError,
  isTerminalStatus,
} from '@/modules/communications/domain/communication';
import {
  buildRecipient,
  InvalidRecipientError,
  isValidEmail,
  maskRecipient,
} from '@/modules/communications/domain/recipient';
import {
  assertTemplateDraft,
  assertTemplateText,
  firstName,
  inspectTemplateText,
  previewTemplate,
  renderTemplate,
  TemplateError,
  TEMPLATE_VARIABLES,
} from '@/modules/communications/domain/template';

/**
 * O DOMINIO DA COMUNICACAO, sem banco e sem rede.
 *
 * O que estes testes protegem nao e "a funcao devolve o valor certo" — e a
 * honestidade do vocabulario: que `sent` nunca signifique entregue, que uma
 * lacuna desconhecida nunca chegue a um cliente, e que o destinatario seja
 * um retrato e nao um ponteiro.
 */

describe('canais e situacoes', () => {
  it('nao existe estado que afirme entrega ao cliente', () => {
    /*
      A LISTA INTEIRA E A GARANTIA. Se alguem acrescentar `delivered` ou `read`
      sem a infraestrutura que os prove, este teste cai — e e a unica barreira
      automatica contra a tela afirmar um fato que ninguem observou.
    */
    expect([...MESSAGE_STATUSES]).toEqual(['queued', 'sending', 'sent', 'failed', 'cancelled']);
    expect(MESSAGE_STATUSES).not.toContain('delivered');
    expect(MESSAGE_STATUSES).not.toContain('read');
  });

  it('o rotulo de `sent` fala do provedor, nao do cliente', () => {
    expect(MESSAGE_STATUS_LABEL.sent).toBe('Enviada ao provedor');
    expect(MESSAGE_STATUS_LABEL.sent.toLowerCase()).not.toContain('entregue');
    expect(MESSAGE_STATUS_LABEL.sent.toLowerCase()).not.toContain('recebid');
  });

  it('nenhum rotulo de situacao promete entrega', () => {
    for (const status of MESSAGE_STATUSES) {
      const rotulo = MESSAGE_STATUS_LABEL[status].toLowerCase();
      expect(rotulo).not.toContain('entregue');
      expect(rotulo).not.toContain('lida');
    }
  });

  it('so `failed` pode ser reenviada', () => {
    expect(canRetry('failed')).toBe(true);
    for (const status of MESSAGE_STATUSES.filter((s) => s !== 'failed')) {
      expect(canRetry(status)).toBe(false);
      expect(explainNotRetryable(status).length).toBeGreaterThan(10);
    }
  });

  it('cancelar vale antes de qualquer aceitacao, e so', () => {
    expect(canCancel('queued')).toBe(true);
    expect(canCancel('failed')).toBe(true);
    expect(canCancel('sent')).toBe(false);
    expect(canCancel('sending')).toBe(false);
    expect(canCancel('cancelled')).toBe(false);
  });

  it('terminal e `sent` ou `cancelled` — `failed` nao e fim de linha', () => {
    expect(isTerminalStatus('sent')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(false);
  });

  it('o canal decide o tipo de contato e quem tem assunto', () => {
    expect(CHANNEL_CONTACT_TYPE.whatsapp).toBe('phone');
    expect(CHANNEL_CONTACT_TYPE.sms).toBe('phone');
    expect(CHANNEL_CONTACT_TYPE.email).toBe('email');

    expect(channelUsesSubject('email')).toBe(true);
    expect(channelUsesSubject('whatsapp')).toBe(false);
    expect(channelUsesSubject('sms')).toBe(false);
  });

  it('nenhum canal carrega nome de fornecedor', () => {
    /*
      O canal e `whatsapp`; quem entrega pode mudar amanha. Um canal chamado
      `meta_cloud_api` faria a troca de fornecedor virar migration.
    */
    for (const canal of COMMUNICATION_CHANNELS) {
      expect(canal).toMatch(/^[a-z]+$/);
      expect(CHANNEL_LABEL[canal].length).toBeGreaterThan(0);
    }
    expect([...COMMUNICATION_CHANNELS]).toEqual(['whatsapp', 'email', 'sms']);
  });

  it('reconhece e recusa valores fora dos conjuntos', () => {
    expect(isCommunicationChannel('whatsapp')).toBe(true);
    expect(isCommunicationChannel('telegram')).toBe(false);
    expect(isMessageStatus('sent')).toBe(true);
    expect(isMessageStatus('delivered')).toBe(false);
    expect(MESSAGE_ORIGINS).toContain('manual');
    expect(MESSAGE_PURPOSES).toContain('ready_for_pickup');
  });
});

describe('erros de entrega', () => {
  it('todo erro tem rotulo em portugues', () => {
    for (const erro of DELIVERY_ERRORS) {
      expect(DELIVERY_ERROR_LABEL[erro].length).toBeGreaterThan(5);
    }
  });

  it('so erro transitorio vale retentativa automatica', () => {
    expect(isRetryableError('provider_unavailable')).toBe(true);
    expect(isRetryableError('rate_limited')).toBe(true);
    expect(isRetryableError('timeout')).toBe(true);

    /*
      Numero invalido nao melhora com insistencia: reenviar dez vezes para um
      telefone errado e dez falhas e, num provedor real, dez cobrancas.
    */
    expect(isRetryableError('invalid_recipient')).toBe(false);
    expect(isRetryableError('rejected')).toBe(false);
    expect(isRetryableError('provider_not_configured')).toBe(false);
  });

  it('reconhece erro conhecido e recusa texto cru de fornecedor', () => {
    expect(isDeliveryError('timeout')).toBe(true);
    expect(isDeliveryError('ERR_META_131047')).toBe(false);
  });
});

describe('destinatario e um retrato', () => {
  it('telefone vira digitos no valor e formatado na exibicao', () => {
    const retrato = buildRecipient({
      channel: 'whatsapp',
      rawValue: '(11) 99999-8888',
      customerId: 'cliente-1',
    });

    expect(retrato.value).toBe('11999998888');
    expect(retrato.display).toContain('11');
    expect(retrato.customerId).toBe('cliente-1');
  });

  it('e-mail e normalizado para minusculas', () => {
    const retrato = buildRecipient({ channel: 'email', rawValue: '  Maria@Loja.COM.BR ' });
    expect(retrato.value).toBe('maria@loja.com.br');
    expect(retrato.display).toBe('maria@loja.com.br');
  });

  it('recusa destino vazio e destino invalido para o canal', () => {
    expect(() => buildRecipient({ channel: 'sms', rawValue: '   ' })).toThrow(
      InvalidRecipientError,
    );
    expect(() => buildRecipient({ channel: 'email', rawValue: 'sem-arroba' })).toThrow(
      InvalidRecipientError,
    );
    expect(() => buildRecipient({ channel: 'whatsapp', rawValue: '123' })).toThrow(
      InvalidRecipientError,
    );
  });

  it('o retrato NAO guarda ponteiro para o contato do cadastro', () => {
    /*
      `customer_contacts` e apagado e reinserido a cada edicao do cliente. Uma
      chave para la estaria quebrada na primeira correcao de telefone, e o
      historico passaria a responder "nao sei" a "para onde mandamos?".
    */
    const retrato = buildRecipient({ channel: 'sms', rawValue: '11999998888' });
    expect(Object.keys(retrato).sort()).toEqual(['customerId', 'display', 'value']);
  });

  it('a mascara esconde o suficiente e mostra o bastante', () => {
    const telefone = maskRecipient('whatsapp', '(11) 99999-8888');
    expect(telefone).toContain('8888');
    expect(telefone).not.toContain('99999');

    const email = maskRecipient('email', 'maria.souza@loja.com.br');
    expect(email.startsWith('ma')).toBe(true);
    expect(email).toContain('@loja.com.br');
    expect(email).not.toContain('souza');
  });

  it('valida a forma do e-mail sem consultar a rede', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a b@c.com')).toBe(false);
  });
});

describe('template e texto com lacunas, nao programa', () => {
  it('preenche as lacunas do catalogo', () => {
    const texto = renderTemplate(
      'Ola {{cliente.primeiro_nome}}, sua {{os.numero}} esta pronta na {{unidade.nome}}.',
      {
        'cliente.primeiro_nome': 'Maria',
        'os.numero': 'OS #000123',
        'unidade.nome': 'Loja Centro',
      },
      ['always', 'service_order'],
    );

    expect(texto).toBe('Ola Maria, sua OS #000123 esta pronta na Loja Centro.');
  });

  it('RECUSA lacuna que nao existe no catalogo', () => {
    expect(() =>
      renderTemplate('Ola {{cliente.apelido}}', { 'cliente.nome': 'Maria' }, ['always']),
    ).toThrow(TemplateError);
  });

  it('RECUSA lacuna sem valor em vez de mandar a mensagem pela metade', () => {
    /*
      "Ola , seu aparelho esta pronto" chega ao celular de uma pessoa real.
      Entre recusar antes e constranger depois, o dominio recusa antes.
    */
    expect(() => renderTemplate('Ola {{cliente.nome}}', {}, ['always'])).toThrow(TemplateError);
    expect(() =>
      renderTemplate('Ola {{cliente.nome}}', { 'cliente.nome': '   ' }, ['always']),
    ).toThrow(TemplateError);
  });

  it('RECUSA lacuna mal escrita, que viraria chave literal na mensagem', () => {
    expect(() => assertTemplateText('Ola {{cliente.nome', ['always'])).toThrow(TemplateError);
    expect(() => assertTemplateText('Ola {{ }}', ['always'])).toThrow(TemplateError);
  });

  it('RECUSA variavel de OS quando a mensagem nao tem OS', () => {
    expect(() => assertTemplateText('Sua {{os.numero}} esta pronta', ['always'])).toThrow(
      TemplateError,
    );
    expect(() =>
      assertTemplateText('Sua {{os.numero}} esta pronta', ['always', 'service_order']),
    ).not.toThrow();
  });

  it('NAO reexpande o valor: o que sai de uma lacuna e texto final', () => {
    /*
      Um cliente cadastrado como "{{empresa.nome}}" nao pode fazer o proprio
      cadastro injetar conteudo na mensagem — nem levar a um laco infinito.
    */
    const texto = renderTemplate('Ola {{cliente.nome}}!', { 'cliente.nome': '{{empresa.nome}}' }, [
      'always',
    ]);
    expect(texto).toBe('Ola {{empresa.nome}}!');
  });

  it('nao ha eval, funcao nem expressao — so substituicao', () => {
    const codigo = String(renderTemplate);
    expect(codigo).not.toContain('eval');
    expect(codigo).not.toContain('Function(');

    /* Uma "expressao" no template e chave desconhecida, e chave desconhecida e recusa. */
    expect(() => renderTemplate('{{ 1 + 1 }}', { 'cliente.nome': 'x' }, ['always'])).toThrow(
      TemplateError,
    );
  });

  it('a inspecao separa usadas, desconhecidas e malformadas', () => {
    const analise = inspectTemplateText(
      'Ola {{cliente.nome}}, {{cliente.nome}} e {{nao.existe}} e {{quebrado',
    );
    expect(analise.used).toEqual(['cliente.nome']);
    expect(analise.unknown).toEqual(['nao.existe']);
    expect(analise.malformed).toBe(1);
  });

  it('a pre-visualizacao usa exemplos e nunca falha por falta de valor', () => {
    const corpo = TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(' ');
    const preview = previewTemplate(corpo);
    for (const variavel of TEMPLATE_VARIABLES) {
      expect(preview).toContain(variavel.example);
    }
  });

  it('o primeiro nome sai do nome completo, sem cadastro paralelo', () => {
    expect(firstName('Maria Aparecida de Souza')).toBe('Maria');
    expect(firstName('  Joao  ')).toBe('Joao');
  });
});

describe('rascunho de modelo', () => {
  it('e-mail exige assunto; WhatsApp recusa assunto', () => {
    expect(() =>
      assertTemplateDraft({
        name: 'Pronto',
        channel: 'email',
        purpose: 'ready_for_pickup',
        subject: null,
        body: 'Corpo',
      }),
    ).toThrow(TemplateError);

    expect(() =>
      assertTemplateDraft({
        name: 'Pronto',
        channel: 'whatsapp',
        purpose: 'ready_for_pickup',
        subject: 'Nao deveria existir',
        body: 'Corpo',
      }),
    ).toThrow(TemplateError);
  });

  it('valida o texto do assunto contra o catalogo, igual ao corpo', () => {
    expect(() =>
      assertTemplateDraft({
        name: 'Pronto',
        channel: 'email',
        purpose: 'ready_for_pickup',
        subject: 'Sobre a {{os.inexistente}}',
        body: 'Corpo',
      }),
    ).toThrow(TemplateError);
  });

  it('devolve o rascunho limpo quando tudo esta certo', () => {
    const draft = assertTemplateDraft({
      name: '  Aparelho pronto  ',
      channel: 'whatsapp',
      purpose: 'ready_for_pickup',
      subject: '',
      body: '  Ola {{cliente.primeiro_nome}}, sua {{os.numero}} esta pronta.  ',
    });

    expect(draft.name).toBe('Aparelho pronto');
    expect(draft.subject).toBeNull();
    expect(draft.body.startsWith('Ola')).toBe(true);
  });
});
