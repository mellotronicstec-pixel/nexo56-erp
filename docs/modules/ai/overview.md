# Nexo56 AI — visão geral

**Prompt 20.** Módulo **OPCIONAL** (`ai.core` + `ai.writing`, dependente de
`ai.core`), independente de qualquer módulo operacional para o resto do ERP
funcionar.

## A pergunta que o módulo responde

> Como ajudar quem escreve — sem a IA decidir nada por essa pessoa?

Nexo56 AI é a primeira camada de inteligência artificial do produto: um
assistente de **escrita controlada** em português, para cinco ações fixas,
sobre dois campos de texto reais já existentes. Nada mais.

> **"Nexo56 AI sugere; o humano decide."**

Esse princípio percorre toda decisão de arquitetura deste módulo — ver
[ADR-085](../../adr/ADR-085-nexo56-ai-gateway-e-assistencia-segura-de-escrita.md).

## O que ele é — e o que ele não é

| É                                            | Não é                                           |
| -------------------------------------------- | ----------------------------------------------- |
| Cinco ações fixas, em um catálogo fechado    | Chat aberto / "pergunte qualquer coisa"         |
| Sugestão de texto para revisão humana        | Escrita automática em `service_orders`/`quotes` |
| Melhoria de estilo, preservando fato técnico | Reinterpretação de diagnóstico ou conclusão     |
| Contexto mínimo, montado pelo servidor       | "Mande a OS inteira para a IA, por comodidade"  |
| Gateway agnóstico de fornecedor              | Integração fixa com um vendor específico        |
| Telemetria operacional (`ai_requests`)       | Histórico navegável de conteúdo gerado          |

## As cinco ações, e só essas cinco

| Chave                            | Rótulo                           |
| -------------------------------- | -------------------------------- |
| `CORRIGIR_PORTUGUES`             | Corrigir português               |
| `DEIXAR_MAIS_PROFISSIONAL`       | Deixar mais profissional         |
| `RESUMIR`                        | Resumir                          |
| `DEIXAR_MAIS_CLARO_PARA_CLIENTE` | Deixar mais claro para o cliente |
| `GERAR_PARECER_TECNICO`          | Gerar parecer técnico            |

Detalhe de cada uma: [task-catalog.md](task-catalog.md).

## Os dois campos reais de hoje

| Superfície                     | Campo                           | Módulo dono            |
| ------------------------------ | ------------------------------- | ---------------------- |
| `service_order.internal_notes` | `service_orders.internal_notes` | Ordens de Serviço (07) |
| `quote.customer_notes`         | `quotes.customer_notes`         | Orçamentos (09)        |

Nenhum campo foi inventado — os dois já existiam antes do Prompt 20.
Detalhe: [surface-catalog.md](surface-catalog.md).

## O que este módulo NUNCA faz

- Escrever em `service_orders`, `quotes`, `communication_messages`,
  `inventory`, `finance`, `warranties` ou `agenda_tasks`.
- Mudar status, aprovar orçamento, comprar peça, mover estoque, liquidar
  título, enviar comunicação ou disparar automação.
- Ler ou escrever fora do escopo de tenant/unidade autorizado da sessão.
- Rodar prompt livre, ferramenta, busca na web, banco de conhecimento ou
  memória de conversa.
- Persistir o texto original, o prompt ou a sugestão gerada.
- Fingir ter uma sugestão real quando não há provedor configurado.

## O provedor hoje: captura (nenhum vendor decidido)

Não existe contrato com OpenAI, Anthropic, Google ou qualquer outro
fornecedor de modelo de linguagem. Fora de produção, o sistema usa um
**provedor de captura**, determinístico, sem rede. Em produção, não há
provedor nenhum — a geração falha com `AI_PROVIDER_NOT_CONFIGURED`, e a UI
mostra "Nexo56 AI nao esta configurada para uso neste ambiente." Detalhe:
[providers.md](providers.md).

## Onde cada coisa mora

| Conceito                                    | Arquivo                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| Erros, status da requisição                 | `domain/ai-request.ts`                                       |
| Catálogo de tasks                           | `domain/task-catalog.ts`                                     |
| Catálogo de superfícies                     | `domain/surface-catalog.ts`                                  |
| Guarda de significado técnico               | `domain/technical-anchors.ts`                                |
| Porta do provedor                           | `application/ai-provider.ts`                                 |
| Prompt builder (delimitação, anti-injeção)  | `application/prompt-builder.ts`                              |
| Validação da saída                          | `application/output-validator.ts`                            |
| Orquestrador (autorização composta + fluxo) | `application/generate-draft-service.ts`                      |
| Schema e migration                          | `infrastructure/schema.ts`, `drizzle/0018_ai_requests.sql`   |
| Provedor de captura + guarda de produção    | `infrastructure/capture-provider.ts`, `provider-registry.ts` |
| Repositório de telemetria (sem conteúdo)    | `infrastructure/ai-request-repository.ts`                    |
| Server Action                               | `src/app/(app)/ai/actions.ts`                                |
| Componente de UI reutilizável               | `src/app/(app)/ai/ai-writing-menu.tsx`                       |
| Integração real                             | Editor de OS, Editor de Orçamento                            |
