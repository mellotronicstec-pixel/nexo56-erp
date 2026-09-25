# Provedores

## Nenhum vendor foi decidido

Antes de escolher qualquer fornecedor comercial, o Prompt 20 exigiu
inspecionar docs, exemplos de env, ADRs e dependências em busca de uma
decisão anterior de vendor. **Nenhuma existe.** Não há contrato com OpenAI,
Anthropic, Google ou qualquer outro fornecedor de modelo de linguagem — nem
documentado, nem implícito em alguma dependência já instalada.

Por isso, o Prompt 20 **não escolhe** um vendor em silêncio. Ele implementa:

- o contrato do provedor (`AiProvider`, [architecture.md](architecture.md));
- o registry que decide qual provedor está ativo;
- o comportamento de "provedor indisponível";
- um provedor de captura para desenvolvimento e teste;
- o ponto de extensão para um provedor real entrar depois.

E registra isto como **limitação externa explícita**: produção não tem
Nexo56 AI disponível até que um provedor real seja contratado e configurado.

## O provedor de captura

`src/modules/ai/infrastructure/capture-provider.ts` — `CaptureAiProvider`.
Mesmo papel do `CaptureProvider` de Comunicação (Prompt 16): não chama
nenhum vendor. Por padrão, devolve uma transformação mínima e determinística
do texto de entrada — o bastante para provar o fluxo ponta a ponta em
desenvolvimento e teste sem depender de rede.

Testes programam a próxima resposta via `respondNext(result, delayMs?)`:
sucesso com texto específico, timeout (usando `delayMs` maior que o timeout
configurado no teste), output inválido, risco técnico ou contexto
insuficiente — sem depender de um vendor real existir.

## A guarda de produção

```
FORA DE PRODUÇÃO → CaptureAiProvider, determinístico
EM PRODUÇÃO       → null, e a geração falha com AI_PROVIDER_NOT_CONFIGURED
```

`assertNotProduction()` é chamada de **dentro** de `generate()` — não é um
guard externo contornável — e não existe nenhuma variável de ambiente que
ligue a captura em produção. Testado com `NODE_ENV=production` real (não
simulado), tanto em unidade (`ai-capture-provider.test.ts`) quanto em
integração contra MariaDB (`ai-writing.test.ts`).

## O que a UI mostra sem provedor real

Mensagem exata (sem acento, pela convenção do projeto): **"Nexo56 AI nao
esta configurada para uso neste ambiente."** — sem stack trace, sem detalhe
de erro, sem menção a qual
vendor faltou. O código de erro estável é `AI_PROVIDER_NOT_CONFIGURED`.

## Quando um provedor real existir

Ele entra inteiramente em `src/modules/ai/infrastructure/provider-registry.ts`
— implementando `AiProvider`, lendo credencial de um mecanismo de segredo
(cofre avançado é trabalho do Prompt 25). Nenhuma mudança é necessária em
domínio, aplicação ou UI: o contrato já existe e já é exercido pelos
mesmos testes que hoje rodam contra a captura.

## Timeout e retry

Todo request ao provedor tem um timeout finito no lado do CHAMADOR
(`generate-draft-service.ts`, `callProviderWithTimeout`, 20s por padrão,
`setAiProviderTimeoutMsForTesting` só em teste) — independente do
adaptador concreto respeitar `options.timeoutMs` por conta própria. Não há
retry automático agressivo: uma geração pode ter custo, e a falha vira
`AI_PROVIDER_TIMEOUT`/`AI_PROVIDER_ERROR` explícito, com o usuário decidindo
se tenta de novo manualmente. Quando um SDK real de provedor for adotado, o
relatório de integração daquele provedor precisa registrar se o SDK tem
retry automático embutido por padrão — isso não existe hoje porque não há
SDK nenhum instalado.
