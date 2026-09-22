# Comunicação — ciclo de vida de uma mensagem

## Por que a transação é curta

A decisão estrutural do módulo é onde a transação de banco termina:

1. **Transação curta**: grava `communication_messages` (status `queued`),
   auditoria e evento — commit.
2. **Fora da transação**: a tentativa de entrega, que fala com um provedor.

Uma chamada de rede dentro da transação prenderia linhas do InnoDB pelo tempo
que o fornecedor levar para responder, e um provedor lento viraria lentidão do
ERP inteiro para todos os tenants. Pior: se o commit falhasse depois do envio,
o cliente saberia de algo que o banco não registrou.

Com a transação curta, a pior falha possível é uma mensagem `queued` que
ninguém processou — visível, na fila, e desatolada pelo job de recuperação.

## O passo a passo de `createMessage`

1. Resolve a unidade (do contexto, nunca do formulário) e autoriza
   `communications.send`.
2. Resolve o destinatário **a partir do cadastro do cliente** — nunca de um
   campo livre (ver `resolveRecipient`).
3. Resolve o contexto de variáveis (`resolveTemplateContext`): nome do
   cliente, da empresa, da unidade e, se houver OS, número/estado/aparelho.
4. Resolve o texto: de um modelo (copiado e renderizado) ou digitado na hora
   — os dois passam pelo mesmo renderizador, que recusa lacuna desconhecida
   ou vazia.
5. Se houver `attachWarrantyId`, lê os bytes **agora**, pelo serviço
   autorizado (`readCertificatePdf`), que confere tenant/unidade/permissão.
6. Confere a chave de idempotência — clique duplo reencontra a mensagem.
7. **Transação**: insere a mensagem (`queued`), o anexo (se houver),
   auditoria, evento `MESSAGE_CREATED`. Commit.
8. **Fora da transação**: chama `processMessage`.

## `processMessage`: a reivindicação é um `UPDATE` condicional

```sql
UPDATE communication_messages
   SET status = 'sending', version = version + 1
 WHERE id = ? AND tenant_id = ? AND status = 'queued'
```

Zero linhas afetadas = perdeu a corrida, sai. Não há `SELECT` antes: entre ler
e escrever cabe outra execução inteira, e é nesse vão que nasceriam duas
tentativas para a mesma mensagem (ADR-044).

Depois de reivindicar, o serviço:

- Busca o provedor (`getCommunicationProvider()`); se `null`, a tentativa
  falha com `provider_not_configured`.
- Lê os anexos; se houver algum e `context` for `null` (execução por job, sem
  usuário), a tentativa falha — ler o certificado exige permissão que um job
  não tem.
- Chama `provider.send(...)`. Uma exceção do adaptador vira falha `unknown`,
  nunca sucesso.
- `finishAttempt`: **uma transação** grava a tentativa (append-only) e move a
  mensagem — `sent` ou `failed` — só se ela ainda estiver `sending` (se foi
  cancelada no meio, o `UPDATE` não afeta nada e a tentativa permanece
  registrada).

## Reenviar e cancelar

- `retryMessage`: só `failed` → `queued`, via `UPDATE ... WHERE status =
'failed'`. É a MESMA mensagem — uma tentativa nova é anexada, nenhuma linha
  nova em `communication_messages`.
- `cancelMessage`: só `queued`/`failed` → `cancelled`. O que já foi aceito
  pelo provedor está fora de alcance: cancelar ali seria fingir que a
  mensagem deixou de existir.

## O job de recuperação

`sweepStuckMessages` trata duas situações diferentes, com respostas
diferentes:

| Estado parado (>10 min) | O que aconteceu                            | O que o job faz                                               |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `queued`                | ninguém tentou                             | tenta agora, com segurança                                    |
| `sending`               | o processo pode ter caído no meio do envio | vira `failed` com motivo explícito — nunca reprocessa sozinho |

O segundo caso é o que separa um job correto de um que manda mensagem
duplicada: se o processo caiu depois de o provedor aceitar e antes de gravar o
resultado, o cliente já recebeu. Reprocessar automaticamente mandaria a
segunda via.
