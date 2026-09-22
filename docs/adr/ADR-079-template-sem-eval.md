# ADR-079 — Template é texto com lacunas, nunca programa

**Status:** Aceito
**Data:** Prompt 16 — Comunicação
**Itens atendidos:** 21 a 25

## Contexto

Um modelo de mensagem precisa de dados variáveis ("Olá {{cliente.nome}}, sua
{{os.numero}} está pronta"). A forma mais rápida de resolver isso — e a mais
perigosa — é aceitar uma expressão real: `{{ os.numero > 100 ? 'x' : 'y' }}`,
ou pior, `{{ require('fs') }}`. Isso resolve o caso de hoje criando um
interpretador dentro do ERP, com bug próprio, laço próprio e acesso ao escopo
de quem o chamou.

## Decisão

Não existe `eval`, `new Function`, `vm.runInContext` nem qualquer forma de
execução arbitrária em `domain/template.ts`. A sintaxe aceita é **uma só**:
`{{ chave }}`, com espaço opcional em volta e nada mais — sem condicional, sem
laço, sem filtro, sem chamada de método.

O que existe no lugar de uma linguagem é um **catálogo fechado**
(`TEMPLATE_VARIABLES`), com sete entradas hoje, cada uma correspondendo a um
dado que já existe no banco. O tipo `TemplateVariableKey` é derivado do
próprio catálogo (`(typeof TEMPLATE_VARIABLES)[number]['key']`), então
acrescentar uma variável em outro lugar do código sem declará-la aqui é erro
de compilação, não lacuna silenciosa em produção.

## A regra que mais importa: lacuna sem valor é recusa, não vazio

```
"Olá {{cliente.nome}}"  + { }               → RECUSA (TemplateError)
"Olá {{cliente.nome}}"  + { nome: "" }      → RECUSA
"Olá {{cliente.apelido}}" (fora do catálogo) → RECUSA
```

Uma substituição vazia produziria "Olá , seu aparelho está pronto" no celular
de uma pessoa real, com o nome da loja embaixo. Entre recusar antes de
salvar/enviar e constranger o cliente depois, o domínio recusa antes — sempre.

## Substituição única, não recursiva

`renderTemplate` faz **uma** passada. Se o valor de `cliente.nome` fosse
reexaminado, um cliente cadastrado literalmente como `"{{empresa.nome}}"`
faria o próprio cadastro injetar conteúdo na mensagem — e, no limite, um valor
que referencia a si mesmo produziria um laço. O que sai de uma lacuna é texto
final, ponto final.

## Escopo: `always` vs `service_order`

Uma mensagem sem Ordem de Serviço vinculada não pode usar `{{os.numero}}`. A
checagem roda duas vezes, por motivos diferentes:

1. Ao **salvar o modelo** — com todos os escopos, porque um modelo de "ordem
   disponível" é legítimo existir mesmo sem nenhuma OS na tela.
2. Ao **aplicar o modelo a uma mensagem real** — só com os escopos que aquela
   mensagem tem. É aqui que "modelo de OS aplicado numa mensagem avulsa" é
   barrado, com uma mensagem de erro que nomeia a lacuna sobrando.

## Consequência

Um teste de fronteira varre o módulo inteiro atrás de `eval(`, `new Function`
e `vm.runIn`, e falha se encontrar qualquer um. Um teste de unidade confirma
que `String(renderTemplate)` não contém `eval` nem `Function(` no próprio
código-fonte compilado.
