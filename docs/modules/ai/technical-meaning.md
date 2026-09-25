# Technical Meaning Guard

**Technical Anchor Guard** (`domain/technical-anchors.ts`) **+ Semantic
Claim Guard** (`domain/semantic-claims.ts`) **= Technical Meaning Guard**.
As duas camadas rodam sempre juntas em `output-validator.ts`; qualquer uma
reprovando é suficiente para rejeitar com `AI_TECHNICAL_MEANING_RISK`.

Nenhuma das duas é um projeto de NLP — explicitamente fora de escopo (item
56 do Prompt 20). São regex e listas fechadas e pequenas, comparando o
CONJUNTO de âncoras/afirmações entre origem e saída — sem precisar
"entender" o texto.

## Camada 1 — Technical Anchor Guard (número/código/modelo/data)

Encontra "âncoras" (qualquer trecho com pelo menos um dígito, com um
prefixo/sufixo de letra/unidade opcional) e compara o conjunto entre a
origem e a saída do provedor.

### O que conta como âncora

Tensão (`220V`), corrente (`3,5A`), código de erro (`E01`), modelo (`X123`),
data (`05/09/2026`) — qualquer sequência com dígito, com sufixo de até 4
letras diretamente colado (sem espaço) ao número. Uma unidade real separada
por espaço (`220 V`, `3,5 A`) é colada antes da extração
(`collapseUnitSpacing`, usando uma lista fechada de abreviações — V, A, W,
Hz, kg, mm, °C etc.) — assim uma palavra comum do português que apareça
logo depois de um número ("X123 não liga") nunca é lida como se fosse parte
do código.

### Normalização — presentational, não factual

`220V` e `220 V` normalizam para a mesma chave (`220v`) — diferença de
apresentação não é mudança de fato. `220V` e `127V` normalizam para chaves
DIFERENTES (`220v` / `127v`) — mudança de fato.

### A regra é sempre de duas mãos

1. **Nenhuma âncora do RESULTADO pode ser nova** (não existir na origem) —
   vale para as cinco tasks, sempre: nenhuma delas pode inventar
   número/código.
2. **Para `preserve_anchors`:** toda âncora da ORIGEM precisa sobreviver no
   resultado — a task não tem licença para omitir dado técnico.
   `preserve_anchors_allow_omission` (RESUMIR) e `no_new_technical_facts`
   (GERAR_PARECER_TECNICO) dispensam esta segunda checagem: resumir pode
   legitimamente cortar um detalhe secundário, e gerar parecer não precisa
   citar todo campo do contexto.

### Testes de âncora obrigatórios (item 105)

| Original      | Não pode virar |
| ------------- | -------------- |
| `220V`        | `127V`         |
| `E01`         | `E02`          |
| `3,5A`        | `5A`           |
| modelo `X123` | `X132`         |

## Camada 2 — Semantic Claim Guard (fato sem dígito nenhum)

**Correção deliberada de uma lacuna real**: a Camada 1 só protege
sequências com dígito. Ela nunca conseguiria pegar "possível falha" virando
"falha confirmada" — nenhuma âncora numérica muda ali, e ainda assim é
exatamente o tipo de mudança de fato que o item 4 do Prompt 20 proíbe. A
versão anterior desta documentação dizia que esse caso "dependia só da
instrução do system prompt" — **isso não é mais verdade**: agora existe uma
segunda camada determinística, mecânica, testada, que roda antes de
qualquer sugestão chegar ao usuário.

`checkSemanticClaims(sourceText, outputText)` extrai, de cada lado, quais
**famílias de afirmação protegidas** aparecem no texto (normalizado:
minúsculo, sem acento). Uma família só pode aparecer na SAÍDA se já
existia na ORIGEM — regra de uma mão só (diferente da âncora, que tem
duas): nada aqui exige que uma família da origem sobreviva na saída
(`RESUMIR` pode legitimamente omitir uma garantia mencionada), só que a
saída nunca **invente** uma que não existia.

### As cinco famílias protegidas

| Família                | O que pega                                                                      | Exemplo de gatilho na saída                                                                  |
| ---------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `certainty`            | conclusão fechada onde a origem não afirmava isso                               | confirmado, constatado, identificado, diagnosticado, comprovado, definitivamente, certamente |
| `action_repair`        | ação de reparo efetivo onde a origem só recomendava inspeção                    | substituir, trocar, reparar, remover, instalar                                               |
| `promise`              | compromisso firme de prazo onde a origem só tinha previsão                      | "ficará pronto", "será entregue", "concluído até"                                            |
| `warranty`             | garantia mencionada sem existir na origem                                       | garantia, garantido(a)                                                                       |
| `performed_test_claim` | teste/medição/verificação apresentado como FATO JÁ REALIZADO sem base na origem | "foi testado", "foi constatado", "testes realizados", "após os testes"                       |

A origem, para as quatro tasks de reescrita, é o texto original; para
`GERAR_PARECER_TECNICO`, é o `StructuredTechnicalContext` formatado
(mesmo `sourceTextForAnchors` que a Camada 1 já usa — item 11 da correção:
a guarda nunca compara contra um textarea vazio, sempre contra o contexto
real autorizado pelo servidor).

### É defensiva, não um verificador semântico universal (item 9)

As listas são pequenas e fechadas de propósito — não tentam cobrir toda
conjugação do português. Uma reformulação legítima que use vocabulário
fora dessas famílias passa sem problema (ex.: sinônimos de incerteza como
"possível"/"provável"/"suspeita" nunca precisam bater entre si — só o
LADO DA CERTEZA é vigiado). Em contrapartida, uma coincidência lexical rara
pode, em teoria, disparar um falso positivo — por isso ela é sempre a
SEGUNDA camada de uma guarda que nunca tenta consertar a saída sozinha:
falhar aqui sempre rejeita e preserva o original, nunca reescreve por
conta própria.

### Testes obrigatórios (correção do item 13)

| #   | Origem                                     | Saída do provedor                                            | Resultado                                                 |
| --- | ------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------- |
| A   | "possível falha na fonte"                  | "falha na fonte confirmada"                                  | **REJECTED** (`certainty`)                                |
| B   | "suspeita de falha na placa"               | "foi constatada falha na placa"                              | **REJECTED** (`certainty`)                                |
| C   | "verificar placa principal"                | "substituir placa principal"                                 | **REJECTED** (`action_repair`)                            |
| D   | "previsão de análise amanhã"               | "equipamento ficará pronto amanhã"                           | **REJECTED** (`promise`)                                  |
| E   | sem garantia mencionada                    | "serviço coberto pela garantia"                              | **REJECTED** (`warranty`)                                 |
| F   | "equipamento não liga; verificar fonte"    | "após os testes realizados, foi constatado defeito na fonte" | **REJECTED** (`performed_test_claim` + `certainty`)       |
| G   | "possível falha na fonte"                  | "há indícios de possível falha na fonte, ainda em análise"   | **ACCEPTED** — incerteza preservada, nenhuma família nova |
| H   | "verificar placa principal"                | "é necessário verificar a placa principal"                   | **ACCEPTED** — ainda inspeção, nunca reparo               |
| I   | "teste realizado confirmou falha na fonte" | "os testes realizados confirmaram falha na fonte"            | **ACCEPTED** — a família já existia na origem             |
| J   | contexto com garantia válida já mencionada | reafirma a mesma garantia, sem condição nova                 | **ACCEPTED** — família já existia na origem               |

## O que acontece quando qualquer camada falha

Nunca tenta "consertar" a saída com regex e devolver mesmo assim (item 60).
Rejeita com `AI_TECHNICAL_MEANING_RISK`, e o texto original do formulário
permanece intocado — nenhuma escrita de domínio ocorre em nenhum caso
rejeitado. Mensagem exibida ao usuário, verbatim (sem acento, pela
convenção do projeto — ver `AI_ERROR_MESSAGES` em `domain/ai-request.ts`):

> "A sugestao pode ter alterado um dado tecnico. O texto original foi
> preservado."

## Onde a guarda entra no pipeline

`output-validator.ts` chama, nesta ordem, como últimas etapas da
validação (depois do tipo, do sentinela de contexto insuficiente, da
checagem de HTML e do limite de tamanho):

1. `checkTechnicalAnchors(sourceTextForAnchors, sanitizedOutput, task.technicalPolicy)`
2. `checkSemanticClaims(sourceTextForAnchors, sanitizedOutput)`

`sourceTextForAnchors` é o texto original para as quatro tasks de
reescrita, e o contexto estruturado formatado para `GERAR_PARECER_TECNICO`
— o mesmo valor serve às duas camadas, sem PII adicional anexada.
