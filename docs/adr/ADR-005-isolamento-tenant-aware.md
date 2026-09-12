# ADR-005 — Isolamento tenant-aware no acesso a dados

**Status:** Aceito · **Data:** Prompt 01

## Contexto

Com banco compartilhado (ADR-004), esquecer `WHERE tenant_id = ?` vaza dados
entre empresas. O Prompt 01 (item 21) pede que "o caminho seguro seja o caminho
padrão".

## Decisão

Combinação de quatro mecanismos, e não uma bala de prata:

1. **`TenantContext`** — único portador de `tenantId`, construído
   exclusivamente a partir de uma sessão válida no servidor
   (`loadContextForSession`). Nenhuma função de consulta aceita `tenantId`
   como parâmetro solto.
2. **`TenantScope` / `scopedWhere`** — produzem a cláusula `WHERE` já com o
   filtro de tenant combinado às demais condições. `TenantScope.values()`
   sobrescreve qualquer `tenantId` recebido de fora.
3. **`assertOwnership()`** — barreira final para registros que chegaram por
   outro caminho; lança `AuthorizationError`, nunca devolve `false` em silêncio.
4. **Testes de travessia** (`tests/integration/tenant-isolation.test.ts`) —
   obrigatórios, cobrindo os quatro cenários do item 22.

## Motivo

Um filtro explícito e visível é auditável: dá para ler uma consulta e ver onde
o isolamento acontece.

## Alternativas consideradas

| Alternativa                                   | Por que não                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Middleware global do ORM reescrevendo queries | O Drizzle não oferece hook universal confiável para isso, e um filtro invisível torna difícil auditar onde o isolamento ocorre — e silencioso quando falha. |
| Row-Level Security do banco                   | MariaDB não tem RLS como o PostgreSQL.                                                                                                                      |
| Confiar apenas em revisão de código           | Não é mecanismo; é esperança.                                                                                                                               |

## Consequências

- Escrever consulta nova exige usar `scopedWhere`/`TenantScope`; a revisão de
  código deve tratar consulta sem escopo como defeito.
- Cada módulo futuro precisa acrescentar seus próprios testes de travessia.
