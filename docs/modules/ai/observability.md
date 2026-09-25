# Observabilidade

## `ai_requests` — o que existe, e por quê

Uma tabela só. Uma linha por chamada de geração, registrando **metadado
operacional**, nunca o conteúdo processado.

| Coluna                                  | Propósito                                                          |
| --------------------------------------- | ------------------------------------------------------------------ |
| `id`                                    | identificador da requisição                                        |
| `tenant_id`                             | isolamento                                                         |
| `unit_id`                               | nulo quando a superfície não for de unidade (nenhuma hoje é assim) |
| `requested_by`                          | quem pediu                                                         |
| `task_key`, `surface_key`               | qual ação, em qual campo                                           |
| `entity_type`, `entity_id`              | qual registro (sem FK — ver abaixo)                                |
| `prompt_version`                        | qual versão do prompt interno rodou                                |
| `provider_key`, `model_key`             | qual provedor/modelo respondeu (nulo até terminar)                 |
| `status`                                | `requested` → `succeeded` \| `failed` \| `rejected`                |
| `error_code`                            | um `AiErrorCode`, quando `status != 'succeeded'`                   |
| `input_char_count`, `output_char_count` | contagem Unicode-safe, nunca o texto                               |
| `input_tokens`, `output_tokens`         | `null` quando o provedor não informa — nunca inventado             |
| `latency_ms`                            | tempo da chamada ao provedor                                       |
| `created_at`, `completed_at`            | ciclo de vida da requisição                                        |

## Por que não há coluna de texto

Ver [privacy-security.md](privacy-security.md) e
[ADR-085](../../adr/ADR-085-nexo56-ai-gateway-e-assistencia-segura-de-escrita.md).
Resumo: `ai_requests` não é histórico de conteúdo, é telemetria de uso —
"quantas chamadas, quanto tempo, qual task, qual erro" é o que se precisa
para dimensionar e depurar o módulo, nunca "o que foi escrito".

## `AiRequest` ≠ Audit Log

Não há duplicação deliberada. A auditoria (`audit_logs`) continua sendo o
registro de mudança em entidade de domínio — e `ai_requests` nunca grava lá,
porque a IA nunca muda uma entidade de domínio diretamente. Quando o
usuário aplica "Usar texto" e salva pelo fluxo oficial do módulo, a
auditoria normal desse módulo (já existente, sem mudança) registra a
alteração do campo — como qualquer outra edição manual.

## Sem tela de histórico navegável (V1)

Por decisão explícita do Prompt 20 (item 82/118): não existe uma tela para
"ver o que a IA gerou antes". `ai_requests` existe para observabilidade
operacional (relatório futuro, manutenção), não para navegação de usuário —
e como não guarda conteúdo, uma tela assim não teria o que mostrar além de
contadores.

## Status da requisição

`requested` → `succeeded` / `failed` / `rejected`. `rejected` cobriria o
caso em que a autorização falha antes mesmo de chamar o provedor — na
implementação atual, `insertAiRequest` só é chamado DEPOIS da autorização
composta passar, então uma rejeição de feature/permissão/superfície não
grava linha nenhuma (não há nada de operacional a medir numa tentativa que
nem chegou perto do provedor). `rejected` fica reservado no vocabulário de
status para um uso futuro onde isso mude.

## Rate limiting

V1 não implementa um sistema de cota comercial (isso é explicitamente do
Prompt 24). Se o projeto já tiver um mecanismo reutilizável de limitação de
taxa genérico (`core/rate-limit`, usado hoje para login), ele pode ser
aplicado aqui como proteção técnica razoável — nenhuma cota por plano é
implementada neste prompt. Ver [future.md](future.md).

## Onde olhar em performance

Este módulo não tem um arquivo de performance dedicado porque o único hot
path é a leitura da entidade (já indexada pelos módulos donos) e o
INSERT/UPDATE de uma linha só em `ai_requests`, coberto pelos índices
`ix_ai_request_tenant_created` e `ix_ai_request_tenant_user_created`.
Detalhe de EXPLAIN no relatório final do prompt.
