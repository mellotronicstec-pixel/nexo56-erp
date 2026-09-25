# Arquitetura

Decisão completa em
[ADR-085](../../adr/ADR-085-nexo56-ai-gateway-e-assistencia-segura-de-escrita.md).
Este documento é o mapa prático de como o pedido atravessa o sistema.

## Fluxo, do clique ao rascunho

```
Browser (AiWritingMenu)
  → Server Action (src/app/(app)/ai/actions.ts)
    → generateAiDraft (application/generate-draft-service.ts)
        1. Catálogo: surface + task existem e são compatíveis (sem tocar o banco)
        2. Carrega a ENTIDADE, escopada a tenant + unidade autorizada
        3. Autorização COMPOSTA: ai.use + ai.writing + permissão de domínio
        4. Monta o prompt (prompt-builder.ts), valida tamanho de entrada
        5. Registra ai_requests como 'requested' (sem conteúdo)
        6. AiGateway → provider.generate(), com timeout finito
        7. Valida a saída (output-validator.ts: tipo, tamanho, âncoras técnicas)
        8. Fecha ai_requests como 'succeeded'/'failed', devolve o rascunho
  ← { text, taskKey, surfaceKey }  (nunca grava em service_orders/quotes)
```

Nenhuma escrita de domínio acontece neste caminho. As únicas tabelas
tocadas são de LEITURA (`service_orders`, `quotes`) e `ai_requests`
(metadado). "Usar texto" (passo posterior, só no browser) substitui o valor
LOCAL do campo no formulário — salvar continua exigindo o fluxo oficial do
módulo dono.

## Por que o cliente nunca manda "os dados da entidade"

O `entityId` é tudo que o cliente informa. O servidor autoriza, carrega os
campos permitidos da entidade real e monta o contexto mínimo — nunca confia
em um JSON de "dados da OS" que o browser tenha montado. Isso é o que torna
impossível ao Tenant A usar o `entityId` do Tenant B para vazar contexto
(item 44) — a consulta já é escopada por tenant + unidade autorizada antes
de qualquer prompt existir.

## AiGateway / AiProvider — a porta

`src/modules/ai/application/ai-provider.ts`:

```ts
interface AiGenerationRequest {
  taskKey;
  promptVersion;
  systemPrompt;
  userContent;
  language: 'pt-BR';
  maxOutputChars;
}

type AiGenerationResult =
  | { outcome: 'generated'; text; inputTokens; outputTokens }
  | { outcome: 'error'; kind: 'timeout' | 'provider_error' | 'invalid_output'; detail };

interface AiProvider {
  name;
  modelKey;
  generate(request, options: { timeoutMs }): Promise<AiGenerationResult>;
}
```

O domínio e a UI nunca veem além desta porta. Nenhum SDK de vendor, nenhuma
API key e nenhuma lógica específica de fornecedor existe fora de
`infrastructure/`. Detalhe do provedor de hoje (captura) e da ausência de
decisão de vendor: [providers.md](providers.md).

## Por que uma tabela só, e sem conteúdo

`ai_requests` é telemetria operacional — nunca o texto processado. Ver
[observability.md](observability.md) para o porquê completo e
[privacy-security.md](privacy-security.md) para a classificação de dados.

## Fronteiras de arquitetura (testadas)

- **Domínio nunca depende de `ai`.** `service-orders`, `quotes` e qualquer
  outro módulo operacional funcionam inteiramente sem o módulo `ai` existir
  — a feature `ai.writing` desligada não degrada nenhum fluxo existente.
- **`ai` nunca escreve fora de `ai_requests`.** Não importa
  `service-orders/infrastructure` nem `quotes/infrastructure` para
  escrita — só leitura via os serviços de consulta já existentes
  (`findServiceOrderDetail`, `loadQuote`).
- **Motor de Automações não ganhou nenhuma ação de IA neste prompt.** O
  catálogo de ações do Prompt 19 continua com exatamente as duas ações que
  já existiam.
- **Portal do Cliente não usa IA neste prompt.** Nenhuma rota do Portal
  importa `ai`.

## Extensão futura (Prompt 21/22), sem reconstruir o gateway

`AiGateway`, o registry de provedor, e o padrão de catálogo fechado (task +
surface) já são genéricos o bastante para receber novas tasks e novas
surfaces sem mudar a forma do pedido. Prompt 21 (Busca de Peças por IA) e
Prompt 22 (Base de Conhecimento/Diagnóstico) acrescentam catálogo próprio —
nenhum dos dois foi iniciado neste prompt. Ver [future.md](future.md).
