# ADR-008 — Feature Catalog, Entitlements e Effective Access

**Status:** Aceito · **Data:** Prompt 01

## Contexto

A Constituição (item 13) define que a disponibilidade efetiva é:

```
Feature Catalog × Plan Entitlements × Tenant Configuration × User Permissions
= Effective Access
```

e proíbe verificações improvisadas de plano ou módulo espalhadas pelo código.

## Decisão

- **`features`** — catálogo global, com `type` (`CORE`, `OPTIONAL`, `PREMIUM`,
  `BETA`, `INTERNAL`) e `status`. Declarado em código (`FEATURE_CATALOG`).
- **`feature_dependencies`** — dependências formais, com detecção de ciclo
  (`findDependencyCycle`) executada antes de qualquer gravação.
- **`plans` / `plan_entitlements`** — o que o plano libera. Ausência de linha
  significa _não contemplado_.
- **`tenant_features`** — o que a empresa ativou. **Desativar não apaga**: a
  linha permanece com `enabled = false`, `disabled_at` preenchido, e o
  histórico intacto.
- **`EffectiveAccessService`** (`effective-access.ts`) — responsabilidade única
  de decidir acesso. Retorna decisão **com motivo** (`PLAN_NOT_ENTITLED`,
  `TENANT_DISABLED`, `DEPENDENCY_UNSATISFIED`, `PERMISSION_DENIED`…), o que
  permite à interface explicar em vez de apenas esconder.
- `CORE` é sempre _entitled_ e sempre ativo — é estrutural e não pode ser
  desativado (Prompt 00, item 12).
- O menu consome o mesmo serviço (`checkManyAccess`, um único snapshot para
  evitar N+1), mas **cada página revalida no servidor**.

## Motivo

Centralizar a decisão é o que permite trocar regras comerciais depois sem
caçar `if (plano === 'premium')` espalhado por módulos.

## Alternativas consideradas

| Alternativa                              | Por que não                                                 |
| ---------------------------------------- | ----------------------------------------------------------- |
| Checagem de plano dentro de cada módulo  | É exatamente o que a Constituição proíbe (item 13).         |
| Feature flags em arquivo de configuração | Não comporta multi-tenant nem plano comercial.              |
| Serviço externo de feature flags         | Dependência externa desnecessária e mais um ponto de falha. |

## Consequências

- Toda funcionalidade nova responde às 12 perguntas do item 102 antes de entrar.
- O catálogo só declara o que existe de fato: 6 features `CORE` e 1 `OPTIONAL`
  (`platform.multi_unit`), todas com código correspondente.
- `PREMIUM`, `BETA` e `INTERNAL` existem como tipo, mas sem entrada — declarar
  feature sem implementação seria placeholder falso (Prompt 01, item 82).
