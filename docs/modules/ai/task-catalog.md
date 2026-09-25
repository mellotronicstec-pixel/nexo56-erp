# Catálogo de tasks

`src/modules/ai/domain/task-catalog.ts` — `AI_TASK_CATALOG`, fechado. Nenhuma
task existe fora desta lista; `findAiTask(key)` devolve `undefined` para
qualquer outra chave, e a camada de aplicação trata isso como
`AI_TASK_NOT_ALLOWED`, nunca como chamada genérica ao provedor.

## Tabela

| Task Key                         | Rótulo                           | Exige texto de entrada? | Pode omitir informação? | Pode gerar conteúdo novo? | Política técnica                  |
| -------------------------------- | -------------------------------- | ----------------------- | ----------------------- | ------------------------- | --------------------------------- |
| `CORRIGIR_PORTUGUES`             | Corrigir português               | sim                     | não                     | não                       | `preserve_anchors`                |
| `DEIXAR_MAIS_PROFISSIONAL`       | Deixar mais profissional         | sim                     | não                     | não                       | `preserve_anchors`                |
| `RESUMIR`                        | Resumir                          | sim                     | **sim**                 | não                       | `preserve_anchors_allow_omission` |
| `DEIXAR_MAIS_CLARO_PARA_CLIENTE` | Deixar mais claro para o cliente | sim                     | não                     | não                       | `preserve_anchors`                |
| `GERAR_PARECER_TECNICO`          | Gerar parecer técnico            | **não**                 | não                     | não                       | `no_new_technical_facts`          |

`canGenerateNewFacts` é `false` nas cinco, sempre — inclusive
`GERAR_PARECER_TECNICO`, que produz prosa nova mas nunca fato novo: todo
número, código, peça ou modelo do parecer precisa já existir no contexto
autorizado da entidade.

## Contrato de cada task

### `CORRIGIR_PORTUGUES`

Corrige ortografia, concordância, pontuação e acentuação — só isso. Nunca
adiciona ou remove fato, nunca muda conclusão, medição ou peça citada.
Exemplo do prompt original: "pode ser a placa" **nunca** pode virar "foi
constatado defeito na placa" — isso não é correção de português, é mudança
de fato.

### `DEIXAR_MAIS_PROFISSIONAL`

Melhora tom, organização e clareza. Preserva os fatos técnicos por inteiro e
nunca transforma incerteza em certeza.

### `RESUMIR`

Pode reduzir o texto e omitir detalhe secundário. Nunca pode: adicionar
fato, trocar um valor, inverter conclusão, transformar possibilidade em
confirmação, remover informação crítica de segurança, ou alterar
significado técnico.

### `DEIXAR_MAIS_CLARO_PARA_CLIENTE`

Converte linguagem técnica em linguagem simples; pode explicar um termo
técnico. Nunca pode: fabricar diagnóstico, prometer resultado, afirmar
compatibilidade não confirmada, alterar responsabilidade/garantia/preço, ou
esconder risco relevante.

### `GERAR_PARECER_TECNICO`

Gera um rascunho de parecer técnico **somente** a partir de informação
genuinamente disponível e autorizada da entidade (equipamento, marca,
modelo, relato do cliente, observações técnicas já registradas). Nunca
busca conhecimento externo, nunca usa Base de Conhecimento (isso é o
Prompt 22), nunca infere um diagnóstico novo, e nunca inventa: teste
realizado, medição, peça defeituosa, troca de componente, causa raiz,
condição estética, garantia, prazo ou preço.

**Contexto insuficiente:** se não houver informação suficiente para um
parecer coerente, a task devolve `AI_INSUFFICIENT_CONTEXT` — nunca produz um
parecer aparentemente completo baseado em suposição. O prompt interno
instrui o provedor a responder exatamente `CONTEXTO_INSUFICIENTE` nesse
caso, e `output-validator.ts` traduz esse sentinela para o código de erro
antes de chegar à UI.

## Preservação de incerteza (obrigatório, todas as tasks)

Se o texto de entrada contém "provável", "suspeita", "possivelmente" ou "a
confirmar", o resultado precisa preservar essa incerteza — nunca a
transforma em afirmação categórica. Coberto por teste em todas as tasks de
reescrita.

## Limites

Todas as cinco: `maxInputChars = 4000`, `maxOutputChars = 4000` — sempre
combinado com o `maxLength` real da superfície (o menor dos dois vence, ver
[surface-catalog.md](surface-catalog.md)).
