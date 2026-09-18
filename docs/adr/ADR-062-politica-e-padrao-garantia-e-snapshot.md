# ADR-062 — Política é padrão sugerido; a garantia é snapshot

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 6, 7, 8, 9, 18, 19, 20, 55

## Contexto

A loja tem um padrão: "3 meses de garantia na mão de obra, não cobre mau uso".
Esse padrão precisa existir em algum lugar para que o balcão não digite tudo à
mão em toda emissão — daí `warranty_policies`.

A tentação seguinte é guardar na garantia apenas `policy_id` e ler os termos da
política na hora de mostrar o certificado. É normalizado, é DRY, e está errado.

O motivo é jurídico antes de ser técnico. Se em março a empresa reduzir a
garantia padrão de 3 meses para 30 dias, o cliente que recebeu um certificado em
janeiro **não** passou a ter 30 dias. Uma leitura viva da política reescreveria
o passado toda vez que alguém corrigisse um texto — e faria a empresa hesitar em
corrigir textos ruins por medo de alterar compromissos já assumidos.

## Decisão

**A política preenche o formulário. A garantia guarda os termos.**

No momento da emissão, `issueWarranty` **copia** para a linha da garantia:
`duration_amount`, `duration_unit`, `coverage_summary`, `exclusions`, `terms` e
os itens de cobertura. `policy_id` fica gravado apenas como **procedência** —
"esta garantia saiu daquele padrão" —, nunca como fonte de leitura.

O certificado vai um passo além: `buildSnapshot()` **não importa nem consulta**
`warranty_policies` em lugar nenhum. Essa ausência é verificada por teste de
fronteira, e não por disciplina.

## Consequências

**Ganhamos:** a política pode ser corrigida, renomeada ou desativada sem tocar
em uma linha do que já foi prometido. Um certificado impresso em janeiro
continua verdadeiro em dezembro.

**Pagamos:** duplicação de texto por garantia — alguns KB por linha. É o preço
literal de não reescrever o passado, e é barato.

**Não fizemos:** versionamento da política com vigência. `version` existe para
concorrência otimista na edição, não para reconstituir "qual era o texto em
janeiro" — a garantia já responde isso sozinha, que era a única pergunta real.
