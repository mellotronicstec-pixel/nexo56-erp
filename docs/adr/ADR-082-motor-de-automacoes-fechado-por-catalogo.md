# ADR-082 — O Motor de Automações é fechado por catálogo, não um interpretador

**Status:** Aceito
**Data:** Prompt 19 — Motor de Automações
**Itens atendidos:** 1 a 30, 51 a 79, 95, 121 a 176, 219/220

## Contexto

O Prompt 19 pede um sistema onde fatos de domínio ou horários disparem ações
automáticas — comunicar o cliente, criar tarefa — configuráveis por quem
administra o tenant, sem exigir código novo a cada regra. A tentação óbvia
seria um pequeno "motor de regras" genérico: strings livres para o gatilho,
expressões livres para a condição, um template de ação interpretado em
runtime. Isso é exatamente o que o item 4 do prompt proíbe: nada de
`eval`/`Function`/SQL livre/HTTP arbitrário, nada de "superusuário mágico".

## Decisão

O Motor **não interpreta** nada que o próprio código não tenha declarado
antecipadamente. Dois catálogos fechados, em código, validados por Zod:

- `AUTOMATION_TRIGGERS` (`trigger-catalog.ts`) — 3 gatilhos, cada um com seu
  próprio conjunto fechado de campos condicionáveis e ações compatíveis.
- `AUTOMATION_ACTION_CATALOG` (`action-catalog.ts`) — 2 ações, cada uma
  delegando a um **serviço oficial** de outro módulo
  (`createMessageFromAutomation`, `createTaskFromAutomation`), nunca escrita
  direta em tabela alheia, nunca chamada a provider concreto.

Uma regra é `{ triggerKey, conditions, actions }` em JSON, mas o JSON **não
é livre**: `parseRuleDefinition` é o único portão de leitura/escrita — valida
existência do gatilho, compatibilidade campo×operador×tipo, compatibilidade
ação×gatilho, e o `configSchema` específico de cada ação, antes de qualquer
gravação ou execução. Nenhum caminho de código aceita uma chave, campo,
operador ou config fora desses catálogos.

**Rule/RuleVersion separados:** a `Rule` é o ponteiro mutável (nome,
habilitada, escopo, `current_version_id`); a `RuleVersion` é imutável.
Editar uma regra cria uma versão nova; uma `Execution` sempre referencia
`rule_version_id`, nunca só `rule_id` — o histórico não muda de sentido
quando a regra é editada depois. Desabilitar/arquivar não apaga nada.

**Idempotência é sempre `UNIQUE` real, nunca `SELECT`-then-`INSERT`**, em
três camadas (execução, tentativa de ação, efeito de domínio) — ver
`docs/modules/automations/idempotency.md` para a cadeia completa e a
evidência de concorrência medida.

## Alternativas consideradas

- **DSL de expressões (tipo JSONLogic) para condições livres.** Rejeitada:
  mesmo restrita, uma DSL de expressões cresce em superfície de ataque e em
  complexidade de validação mais rápido que o benefício justifica para V1,
  que só precisa de `ALL` de igualdade/comparação simples sobre campos já
  conhecidos.
- **Um motor de workflow genérico (grafo de passos, branches, loops).**
  Rejeitada por escopo: o item 4 pede explicitamente V1 pequena e auditável,
  não um orquestrador geral.
- **Regras escritas como registros de banco com SQL/condição livre
  (stored-procedure-like).** Rejeitada de imediato — é literalmente o "nunca
  executar SQL arbitrário" que o prompt proíbe.

## Consequências

- Adicionar um gatilho/ação novo é sempre uma entrada de código nova nos
  catálogos, nunca uma migração de "liberar mais uma string" — versionado,
  revisado, testado como qualquer outra mudança de domínio.
- A UI de configuração de regra é inteiramente derivada dos catálogos
  (`triggersForClient()` projeta a versão serializável) — não existe
  divergência possível entre "o que a tela oferece" e "o que o validador
  aceita", porque os dois leem a mesma fonte.
- O raio de dano de qualquer bug futuro fica travado pelo catálogo: o pior
  caso é mandar uma mensagem com um modelo já aprovado, ou criar uma tarefa
  com texto estático — nunca escrita arbitrária.
