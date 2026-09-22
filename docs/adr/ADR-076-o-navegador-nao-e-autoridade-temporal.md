# ADR-076 — O navegador não é a autoridade temporal do domínio

**Status:** Aceito
**Data:** Prompt 14 — correção final
**Itens atendidos:** 48, 49, 103 (correção pós-revisão)

## O defeito que isto corrige

A primeira implementação de compromissos fazia o **navegador** converter o
campo `datetime-local` em instante:

```ts
// ERRADO — o fuso de quem digitou vira regra do domínio
<input type="hidden" name="startAt" value={new Date(local).toISOString()} />
```

`datetime-local` devolve `"2026-09-22T14:00"` — quatorze horas, **sem fuso
nenhum**. Convertendo no cliente, o instante gravado passa a depender de onde a
pessoa estava. O dono, viajando, marca uma visita "às 14h" e a loja vê 10h. E o
erro é silencioso: nada falha, o dado só fica errado.

## Decisão

O horário civil trafega **cru** do formulário até o caso de uso. Quem converte
é o **servidor**, com o fuso **da unidade**:

```
"2026-09-22T14:00" + timezone da unidade → instante UTC
```

- O formulário manda `startAtLocal` / `endAtLocal`.
- A Server Action **não converte** — ela não conhece o fuso da unidade, e
  adivinhar ali repetiria o mesmo erro um andar acima.
- `appointment-service` resolve o fuso e converte.
- A leitura devolve o fuso de cada unidade consultada, e a tela formata com
  ele — nunca com o `Intl` padrão do navegador.

O schema **recusa** um instante ISO na entrada: se `startAtLocal` vier
`2026-09-22T17:00:00.000Z`, é erro de validação, não conversão tolerante.

## De onde vem o fuso — e o que ainda falta

`units.timezone` **já existia** desde a fundação, anulável, com o comentário
_"Nulo = herda o timezone do tenant"_. Então não houve infraestrutura nova:
apenas passamos a ler uma coluna que sempre esteve lá, com fallback explícito
para `tenants.timezone`.

**A limitação real, declarada:** o `TenantContext` carrega apenas
`tenantTimezone`. O fuso da unidade é obtido por consulta pontual, onde a
unidade já é conhecida — `resolveUnitTimeZone` (uma unidade) e
`resolveUnitTimeZones` (em lote, para a agenda). Levar o fuso da unidade para
dentro do contexto é mudança de fundação e **não foi feita aqui**, para não
ampliar o Prompt 14 com infraestrutura global improvisada.

Nada foi _hardcoded_: `America/Sao_Paulo` aparece apenas como `DEFAULT` da
coluna `tenants.timezone`, onde já estava.

## Horário de verão

A conversão não pode somar um deslocamento fixo — o deslocamento depende do
instante que se quer descobrir. `zonedCivilToInstant` monta os dois candidatos
possíveis (com o deslocamento de antes e o de depois da virada) e pergunta a
cada um se, convertido de volta, devolve o horário pedido:

| Resultado         | Significado                                  | O que é gravado                   |
| ----------------- | -------------------------------------------- | --------------------------------- |
| os dois confirmam | a hora acontece **duas vezes** (`ambiguous`) | a **primeira** ocorrência         |
| nenhum confirma   | a hora **não existe** (`gap`)                | o instante logo **após** a virada |
| um confirma       | hora comum (`exact`)                         | ele                               |

Escolher a segunda ocorrência adiaria o compromisso em uma hora sem que
ninguém tivesse pedido. Recusar a hora inexistente seria defensável, mas
deixaria a pessoa presa num formulário uma vez por ano sem entender o motivo.

**Por que não iterar o deslocamento:** numa hora repetida a iteração converge
para uma das duas ocorrências sem perceber que havia escolha — e acerta por
acidente. Foi exatamente o defeito da primeira tentativa, pego pelo teste.

São Paulo não tem horário de verão desde 2019, então os testes de borda usam
`America/New_York` (vira em março e novembro de 2026). O sistema é
multiempresa: fuso é coluna configurável, não constante.

## Consequência para datas civis

Nada muda para prazo de tarefa, `follow_up_at` e compromisso de dia inteiro:
continuam `VARCHAR(10)` sem fuso (ADR-074). Esta ADR trata apenas do
compromisso **com horário**, que é o único dado do módulo que é instante.
