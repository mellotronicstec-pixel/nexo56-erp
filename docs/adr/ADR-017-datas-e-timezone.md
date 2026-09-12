# ADR-017 — Datas, horários e fuso

**Status:** Aceito · **Data:** Prompt 02

## Contexto

Tenant tem fuso configurável, a unidade poderá ter o seu, e o cron da Hostinger
opera em UTC. Misturar instante com data civil é origem clássica de bug do tipo
"a garantia venceu um dia antes".

## Decisão

### Três conceitos, três tratamentos

| Conceito       | Tipo                           | Exemplo                                         |
| -------------- | ------------------------------ | ----------------------------------------------- |
| **Instante**   | `DATETIME(3)` em **UTC**       | `created_at`, `expires_at`                      |
| **Data civil** | `VARCHAR(10)` ISO `YYYY-MM-DD` | vencimento, competência, início/fim de garantia |
| **Duração**    | `INT` de minutos/dias          | prazo de follow-up, validade de orçamento       |

### `DATETIME`, não `TIMESTAMP`

O `TIMESTAMP` do MariaDB converte pelo fuso da **sessão**, fazendo o valor
depender de como o servidor está configurado. `DATETIME(3)` guarda exatamente o
que foi gravado, e o pool fixa `timezone: 'Z'` — o que entra e sai é UTC puro.

### Data civil não é instante

"Vence em 10/03" é o dia inteiro no fuso do tenant, não um ponto exato em UTC.
Guardar como instante criaria o bug de virar 09/03 para quem está em outro fuso.
Por isso texto ISO, que não sofre conversão nenhuma.

### Conversão

Acontece **na apresentação**, com `Intl.DateTimeFormat` e o `timezone` do
tenant (unidade sobrepõe quando tiver o seu). O horário local do servidor nunca
é regra de negócio.

## Motivo

- UTC no armazenamento torna comparação, ordenação e agregação triviais e
  imunes a horário de verão.
- Separar data civil evita a classe inteira de bugs de "um dia a mais/a menos".
- Fixar `timezone: 'Z'` no pool tira o comportamento das mãos da configuração do
  ambiente — que na Hostinger não controlamos.

## Alternativas consideradas

| Alternativa                     | Por que não                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `TIMESTAMP`                     | Converte pelo fuso da sessão; comportamento dependente de ambiente                                  |
| Guardar no fuso do tenant       | Comparar registros de tenants diferentes exigiria converter tudo; horário de verão quebra ordenação |
| Data civil como `DATE` do MySQL | Funcionaria, mas o driver a converte para `Date` JS, reintroduzindo fuso. Texto ISO é inequívoco    |

## Consequências

- Cron em UTC não é problema: os jobs da fundação são periódicos, não em hora do
  dia. Job futuro que dependa de horário local converte pelo fuso do tenant,
  nunca pelo do servidor.
- Exibir data exige o fuso do tenant no contexto — já presente no
  `TenantContext`.
