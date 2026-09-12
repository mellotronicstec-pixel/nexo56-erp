# ADR-010 — Background jobs e evolução cron → queue

**Status:** Aceito · **Data:** Prompt 01

## Contexto

Decisão do proprietário: processamento assíncrono com abstração que permita
migrar para workers/filas/Redis depois, sem reescrever regra de negócio; jobs
idempotentes, observáveis, recuperáveis e resistentes a execução duplicada.

## Decisão

```
Regra de negócio → enqueue() → tabela `jobs` → JobExecutor → handler
                                                ↑
                                    cron hoje · worker/fila depois
```

- **Fila persistida em banco** (`jobs`), não em memória.
- **Idempotência garantida pelo banco**: `uq_jobs_idempotency_key` (índice
  UNIQUE). Duas chamadas concorrentes com a mesma chave produzem **uma** linha;
  a segunda recebe o job existente. A garantia não é um `if` da aplicação.
- **Reivindicação por UPDATE condicional** (`WHERE id = ? AND status =
'pending'`): dois executores simultâneos, apenas um consegue o job.
- **Retentativa com backoff exponencial** (30s × 2^tentativa, teto de 10 min) e
  `maxAttempts`.
- **Recuperação**: `jobs.requeue-stale` devolve à fila jobs presos em `running`
  por queda de processo.
- **Executor CLI** (`npm run jobs:run`), acionado pelo cron do hPanel.
  Não há rota HTTP de jobs — sem rota, sem superfície a proteger
  (Prompt 01, item 36 prefere execução interna).
- **Cron fora da regra de negócio**: a periodicidade lógica fica declarada em
  `RECURRING_JOBS`; o hPanel chama um único comando. A chave de idempotência
  dos recorrentes é derivada da janela de tempo, então disparo repetido na
  mesma janela não duplica nada.

## Alternativas consideradas

| Alternativa                   | Por que não                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| BullMQ / Redis                | Exige Redis, indisponível no plano inicial; o prompt veda dependência obrigatória de Redis. |
| `setInterval` no processo web | Morre com o processo, duplica em múltiplas instâncias, sem durabilidade.                    |
| Rota HTTP acionada por cron   | Superfície de ataque desnecessária quando o plano permite comando CLI.                      |

## Consequências

- A granularidade depende do cron do hPanel (tipicamente 1 minuto).
- A fila em banco gera carga de polling — irrelevante no volume atual, e
  substituível por fila real quando justificar.
- Trocar o executor não exige tocar em handler nem em regra de negócio.
