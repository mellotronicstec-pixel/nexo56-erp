import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AS FRONTEIRAS DA COMUNICACAO (Prompt 16).
 *
 * Travas ARQUITETURAIS. Os testes de integracao provam que o caminho feliz
 * respeita as regras; eles nao impedem alguem de, daqui a seis meses, resolver
 * um chamado escrevendo `service_orders.status` dentro da Comunicacao, ou
 * colando o nome de um fornecedor numa coluna.
 *
 * Em uma frase: "a comunicacao pode informar o cliente sobre um fato; ela NAO
 * se torna a fonte de verdade desse fato".
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Comentario nao e codigo: sem isto o teste acusa a propria documentacao. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

const FILES = walk(SRC).map((path) => {
  const raw = readFileSync(path, 'utf8');
  return { path, raw, code: stripComments(raw) };
});

const COMUNICACAO = FILES.filter(
  ({ path }) =>
    path.includes(join('modules', 'communications')) ||
    path.includes(join('app', '(app)', 'comunicacao')),
);

const ORDENS = FILES.filter(({ path }) => path.includes(join('modules', 'service-orders')));

describe('o modulo existe', () => {
  it('ha arquivos da Comunicacao para inspecionar', () => {
    expect(COMUNICACAO.length).toBeGreaterThan(5);
  });
});

describe('a Comunicacao NAO e autoridade sobre fato operacional', () => {
  it('nao escreve em service_orders, nem via Drizzle nem em SQL cru', () => {
    /*
      A regra central do prompt. Uma falha de WhatsApp nao pode mover a OS, e
      um envio bem-sucedido tambem nao: quem move a ordem e a transicao
      oficial, por decisao de uma pessoa.
    */
    const drizzle = COMUNICACAO.filter(({ code }) =>
      /\.(insert|update|delete)\s*\(\s*serviceOrders\b/.test(code),
    );
    expect(drizzle.map((f) => f.path)).toEqual([]);

    const cru = COMUNICACAO.filter(({ code }) =>
      /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?service_orders`?/i.test(code),
    );
    expect(cru.map((f) => f.path)).toEqual([]);
  });

  it('nao escreve na linha do tempo nem nas tarefas de fluxo da OS', () => {
    const infratores = COMUNICACAO.filter(
      ({ code }) =>
        /\.(insert|update|delete)\s*\(\s*(serviceOrderTimeline|serviceOrderTasks)\b/.test(code) ||
        /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?service_order_(timeline|tasks)`?/i.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao chama a maquina de estados da OS', () => {
    const infratores = COMUNICACAO.filter(({ code }) =>
      /\btransitionServiceOrder\b|\bnotifyCustomerReady\b/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('a dependencia e de mao unica', () => {
  it('o modulo de Ordens de Servico NAO conhece a Comunicacao', () => {
    /*
      Se a OS importasse a Comunicacao, desligar a feature quebraria o nucleo —
      e o Prompt 16 seria obrigatorio na pratica, apesar de OPCIONAL no papel.
    */
    const infratores = ORDENS.filter(({ code }) => code.includes('modules/communications'));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('a Comunicacao nao depende da Agenda, que tambem e OPCIONAL', () => {
    /*
      Duas features opcionais nao podem se segurar uma na outra: desligar a
      Agenda derrubaria o envio de mensagem, que nada tem a ver com ela.
    */
    const infratores = COMUNICACAO.filter(({ code }) => code.includes('modules/agenda'));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('nenhum fornecedor vazou para dentro do dominio', () => {
  it('nao ha nome de fornecedor no modulo', () => {
    /*
      O canal e `whatsapp`; quem entrega e detalhe operacional. Um
      `twilioSid` aqui faria a troca de fornecedor virar migration.
    */
    const proibidos =
      /\b(twilio|sendgrid|mailgun|zenvia|infobip|nodemailer|smtp|amazon\s?ses|\bses\b|messagebird|gupshup|z-?api)\b/i;
    const infratores = COMUNICACAO.filter(({ code }) => proibidos.test(code));
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('nao ha chamada de rede dentro do modulo', () => {
    /*
      Quem fala com a rede e o adaptador do provedor, que ainda nao existe. Um
      `fetch` aqui significaria que o dominio aprendeu o protocolo de alguem.
    */
    const infratores = COMUNICACAO.filter(({ code }) =>
      /\bfetch\s*\(|axios|node:https?['"]|require\(['"]https?['"]\)/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('segredos e PII', () => {
  it('nao ha credencial literal no modulo', () => {
    const infratores = COMUNICACAO.filter(({ code }) =>
      /(api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('o destinatario nunca vai para o payload de evento', () => {
    /*
      `domain_events` e lido em log e diagnostico. Telefone e e-mail sao PII e
      nao podem cair num lugar que existe para durar e ser inspecionado.
    */
    const servico = COMUNICACAO.find(({ path }) => path.endsWith('message-service.ts'));
    expect(servico).toBeDefined();

    /*
      O padrao nomeia os campos que CARREGAM o dado, e nao a palavra
      `recipient` solta: `recipient.customerId` e um identificador, que o
      payload pode e deve levar. Sao `recipient.value`, `recipient.display`,
      o corpo e o assunto que nao podem sair daqui.
    */
    const pii =
      /recipientValue|recipientDisplay|recipient\s*\.\s*(value|display)|contactValue|\bbody\b|\bsubject\b/;
    const trechos = servico!.code.match(/payload:\s*\{[\s\S]*?\n\s*\},/g) ?? [];
    expect(trechos.length).toBeGreaterThan(0);
    for (const trecho of trechos) {
      expect(trecho).not.toMatch(pii);
    }
  });

  it('o log do modulo nao carrega destino nem corpo', () => {
    const chamadas = COMUNICACAO.flatMap(
      ({ code }) => code.match(/logger\.\w+\([\s\S]*?\n\s*\}\);/g) ?? [],
    );
    expect(chamadas.length).toBeGreaterThan(0);
    for (const chamada of chamadas) {
      expect(chamada).not.toMatch(
        /recipientValue|recipientDisplay|recipient\s*\.\s*(value|display)|\bbody\b|\bsubject\b/,
      );
    }
  });
});

describe('o anexo e referencia, nao atalho', () => {
  it('a Comunicacao NAO guarda nem le chave de armazenamento', () => {
    /*
      Guardar `storage_key` daria a este modulo um caminho para ler o arquivo
      direto, pulando a checagem de permissao do modulo de Garantias. Quem
      quiser os bytes passa por `readCertificatePdf`.
    */
    const infratores = COMUNICACAO.filter(({ code }) =>
      /storageKey|storage_key|getFileStorage/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });

  it('os bytes do anexo vem do servico autorizado', () => {
    const servico = COMUNICACAO.find(({ path }) => path.endsWith('message-service.ts'));
    expect(servico!.code).toContain('readCertificatePdf');
  });
});

describe('o template nao e programa', () => {
  it('nao ha eval, Function nem execucao arbitraria', () => {
    const infratores = COMUNICACAO.filter(({ code }) =>
      /\beval\s*\(|new\s+Function\s*\(|vm\.runIn/.test(code),
    );
    expect(infratores.map((f) => f.path)).toEqual([]);
  });
});

describe('concorrencia', () => {
  it('a reivindicacao da mensagem e um UPDATE condicional, nao um SELECT antes', () => {
    /*
      Entre ler e escrever cabe outra execucao inteira, e e nesse vao que
      nasceriam duas mensagens iguais para o mesmo cliente (ADR-044).
    */
    const servico = COMUNICACAO.find(({ path }) => path.endsWith('message-service.ts'));
    expect(servico!.code).toMatch(/status:\s*'sending'/);
    expect(servico!.code).toMatch(/affectedRows\(/);
    expect(servico!.code).toMatch(/eq\(communicationMessages\.status,\s*'queued'\)/);
  });
});
