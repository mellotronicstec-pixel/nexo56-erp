# Proteção de significado técnico

`src/modules/ai/domain/technical-anchors.ts`. Não é um projeto de NLP —
explicitamente fora de escopo (item 56). É um regex que encontra "âncoras"
(qualquer trecho com pelo menos um dígito, com um prefixo/sufixo de
letra/unidade opcional) e compara o CONJUNTO de âncoras entre o texto de
origem e a saída do provedor.

## O que conta como âncora

Tensão (`220V`), corrente (`3,5A`), código de erro (`E01`), modelo (`X123`),
data (`05/09/2026`) — qualquer sequência com dígito, com sufixo de até 4
letras diretamente colado (sem espaço) ao número. Uma unidade real separada
por espaço (`220 V`, `3,5 A`) é colada antes da extração
(`collapseUnitSpacing`, usando uma lista fechada de abreviações — V, A, W,
Hz, kg, mm, °C etc.) — assim uma palavra comum do português que apareça
logo depois de um número ("X123 não liga") nunca é lida como se fosse parte
do código.

## Normalização — presentational, não factual

`220V` e `220 V` normalizam para a mesma chave (`220v`) — diferença de
apresentação não é mudança de fato. `220V` e `127V` normalizam para chaves
DIFERENTES (`220v` / `127v`) — mudança de fato.

## A regra é sempre de duas mãos

1. **Nenhuma âncora do RESULTADO pode ser nova** (não existir na origem) —
   vale para as cinco tasks, sempre: nenhuma delas pode inventar
   número/código.
2. **Para `preserve_anchors`:** toda âncora da ORIGEM precisa sobreviver no
   resultado — a task não tem licença para omitir dado técnico.
   `preserve_anchors_allow_omission` (RESUMIR) e `no_new_technical_facts`
   (GERAR_PARECER_TECNICO) dispensam esta segunda checagem: resumir pode
   legitimamente cortar um detalhe secundário, e gerar parecer não precisa
   citar todo campo do contexto.

## O que acontece quando a guarda falha

Nunca tenta "consertar" a saída com regex e devolver mesmo assim (item 60).
Rejeita com `AI_TECHNICAL_MEANING_RISK`, e o texto original do formulário
permanece intocado. Mensagem exibida ao usuário, verbatim (sem acento, pela
convenção do projeto — ver `AI_ERROR_MESSAGES` em `domain/ai-request.ts`):

> "A sugestao pode ter alterado um dado tecnico. O texto original foi
> preservado."

## Testes de âncora obrigatórios (item 105)

| Original         | Não pode virar     |
| ---------------- | ------------------ |
| `220V`           | `127V`             |
| `E01`            | `E02`              |
| `3,5A`           | `5A`               |
| modelo `X123`    | `X132`             |
| "possível falha" | "falha confirmada" |

A última linha não é uma âncora numérica — é a regra de preservação de
incerteza (["provável"/"suspeita"/"possivelmente"/"a confirmar" preservados],
[task-catalog.md](task-catalog.md)), testada separadamente e em conjunto com
a guarda de âncoras.

## Onde a guarda entra no pipeline

`output-validator.ts` chama `checkTechnicalAnchors(sourceTextForAnchors,
sanitizedOutput, task.technicalPolicy)` como a última etapa da validação —
depois do tipo, do sentinela de contexto insuficiente, da checagem de
HTML e do limite de tamanho. `sourceTextForAnchors` é o texto original para
as quatro tasks de reescrita, e o contexto estruturado formatado para
`GERAR_PARECER_TECNICO`.
