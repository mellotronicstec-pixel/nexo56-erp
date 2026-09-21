# Interface de Garantias

## Rotas

| Rota                             | O que é                                        |
| -------------------------------- | ---------------------------------------------- |
| `/garantias`                     | visão geral: indicadores, a vencer, retornos   |
| `/garantias/lista`               | lista com filtros e paginação                  |
| `/garantias/[warrantyId]`        | ficha completa                                 |
| `/garantias/retornos`            | retornos recentes                              |
| `/garantias/politicas`           | políticas (exige `warranties.settings.manage`) |
| `/garantias/novo-retorno`        | escolha da garantia a acionar                  |
| `/garantias/certificado/[token]` | certificado resolvido pelo token do QR         |

Mais duas seções embutidas: na ficha da **Ordem de Serviço** e na ficha do
**Equipamento**.

## Indicadores da visão geral

Quatro, e só os que têm definição conferível:

- garantias vigentes;
- vencem em 30 dias;
- retornos no mês;
- retornos cobertos no mês.

**Não há** ranking de técnico, "índice de qualidade" nem "taxa de retrabalho".
Um número que aponta pessoas muda o comportamento da equipe antes de melhorar o
processo: o técnico passa a evitar o conserto difícil, não a errar menos.

"Retorno coberto" usa a definição escrita no domínio — retorno com garantia
vigente no dia **e** avaliado como coberto —, não "qualquer OS nova do mesmo
cliente".

## Duas colunas de estado, sempre

A lista mostra **Situação** (o que a empresa decidiu) e **Vigência** (o que o
calendário diz) em colunas separadas, mais o badge **Acionável**, que é a
conjunção. Juntar as duas numa coluna só faria a tela mentir em dois casos
reais: garantia ativa e vencida, garantia revogada dentro do prazo.

## O que não está acionável diz por quê

`explainNotEnforceable()` devolve a frase pronta: "terminou em 01/03/2026",
"foi revogada", "ainda não está valendo". "Não acionável" sozinho faria o
atendente inventar a explicação no balcão.

## Estado na URL

Busca, tipo, situação, vigência e página são query string. A tela é
compartilhável, recarregável e volta igual no botão voltar.

## Três armadilhas de layout já documentadas

1. **`min-w-0` em item de grid.** Item de grid nasce com `min-width: auto` e
   cresce até o min-content do conteúdo — o `overflow-x-auto` interno nunca
   chega a agir, e a página inteira rola na horizontal em 360px.
2. **Uma ação só no slot `actions` do `PageHeader`.** Aquele slot é `shrink-0`
   de propósito. A navegação do módulo fica no corpo, numa `<nav>` que quebra
   linha.
3. **`touch-target` precisa de `inline-flex items-center`.** `min-height` não se
   aplica a elemento inline não substituído — sem isso, o alvo de toque mede
   17px em vez de 44px.

## Responsividade

Tabela em `md:` para cima, `CardList` abaixo. Verificado de 360px a 1920px.

## Acessibilidade

`FormField` liga rótulo, dica e erro por `aria-describedby`; erro nunca depende
só de cor. Tabelas têm `caption`. Cada seção tem `aria-labelledby`. Nenhum
controle depende de hover.

## Ver, imprimir e baixar são três coisas

A ficha da garantia e a página do certificado oferecem **Ver certificado**
(a tela, que o navegador imprime) e **Baixar PDF** (um `application/pdf` real,
gerado do mesmo snapshot). A interface não chama um de outro, e o texto ao lado
explica que o arquivo é gerado uma vez e reaproveitado.

O botão é um `<a>` com nome acessível — inclui, em `sr-only`, de qual
certificado se trata — e alvo de toque de 44px, verificado em 360px.

## O que a interface nunca promete

Nenhuma tela menciona WhatsApp, SMS, e-mail, PDF, nota fiscal ou compra
automática de peça — e há teste de componente que varre o texto renderizado
procurando exatamente essas palavras.
