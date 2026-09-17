# Interface do Financeiro

Sete rotas. Cada uma responde a uma pergunta que alguém faz em voz alta no
balcão, e nenhuma promete o que o módulo não faz.

| Rota                            | Pergunta que responde                          |
| ------------------------------- | ---------------------------------------------- |
| `/financeiro`                   | como está o dinheiro desta loja, agora         |
| `/financeiro/contas-a-receber`  | quem ainda deve para a loja                    |
| `/financeiro/contas-a-pagar`    | o que a loja ainda deve                        |
| `/financeiro/novo-lancamento`   | lançar o que não tem origem operacional        |
| `/financeiro/titulos/[titleId]` | quanto falta neste título, e o que já foi pago |
| `/financeiro/caixa`             | a gaveta bate?                                 |
| `/financeiro/configuracoes`     | onde o dinheiro fica, como se move e por quê   |

## Uma tela para as duas direções

`contas-a-receber` e `contas-a-pagar` são a mesma tela, parametrizada por
`direction` ([ADR-053](../../adr/ADR-053-titulo-unico-com-direcao.md)). As
rotas são separadas porque o endereço é o que a pessoa guarda nos favoritos e
digita de cabeça — `/financeiro?direcao=receivable` seria igual para a máquina
e pior para quem usa.

A direção vem da rota, **nunca da query string**.

## O estado mora na URL

Busca, situação, "somente vencidos" e faixa de vencimento são query string. A
tela é compartilhável, recarregável e volta igual no botão voltar.

O filtro de vencidos roda **no SQL**, com hoje calculado no fuso da empresa —
filtrar depois de paginar traria 25 linhas e mostraria 6.

## O que a pessoa não pode fazer não aparece

Em vez de aparecer desabilitado. Um botão cinza que ninguém explica gera chamado
no suporte. Esconder é cortesia; a recusa de verdade acontece no caso de uso, na
unidade **do título**.

## Somas de página são ditas como somas de página

Os dois cartões no topo das listas dizem `(nesta página)`. Somar 25 linhas de
300 e chamar de "total em aberto" seria mentira — e quem confere o caixa
somaria errado sem nunca desconfiar.

## As telas dizem o que o sistema não faz

Não é ruído: é o que impede alguém de esperar uma automação que não existe.

- a liquidação por cartão diz que **não fala com a adquirente**;
- as configurações dizem que registrar "PIX" **não integra com banco nenhum**;
- a ficha da OS diz que gerar ou receber **não muda a situação da OS**;
- o pedido de compra diz que **pagar não recebe mercadoria**;
- a visão geral separa realizado de previsto e diz que previsto **é promessa**;
- a ficha do cliente diz que o sistema **mostra e não decide**.

Há testes de componente que falham se essas frases saírem.

## Responsividade: três armadilhas reais

Encontradas no navegador, em 360px e 768px, contra o build de produção.

**1. Item de grid nasce com `min-width: auto`.** Ele cresce até o min-content do
conteúdo — aqui, a largura mínima de uma tabela. O `overflow-x-auto` interno
nunca chegava a agir, porque o cartão já havia esticado, e a página inteira
rolava para o lado em 360px. A correção é `min-w-0` no item do grid.

**2. O slot de ações do `PageHeader` é `shrink-0`.** É o certo — a ação
principal não deve encolher — mas quatro botões ali não cabem em 768px. A
navegação entre as telas do módulo desceu para uma barra própria no corpo, que
quebra linha à vontade, e o cabeçalho ficou com a única ação que de fato cria
alguma coisa.

**3. `min-height` não se aplica a elemento inline não substituído.** A utilitária
`.touch-target` (44×44) media 17px num `<a>` solto: sem `inline-flex`, o
navegador ignora a altura mínima. Todo alvo de toque no módulo carrega
`touch-target inline-flex items-center`.

## Acessibilidade

`axe-core` em WCAG 2.0/2.1 A e AA contra o build de produção, em todas as telas
do módulo: **zero violação séria ou crítica**. Alvos de toque ≥ 44px em 360px.
Sem rolagem horizontal em 360, 390, 768, 1024, 1280, 1440 e 1920px.

## O frontend nunca é autoridade

Total, saldo, situação, permissão, empresa e unidade são **recalculados pelo
servidor** a cada chamada. As Server Actions são camada fina: leem o
formulário, convertem pt-BR para decimal técnico e chamam o caso de uso. A
mesma regra vale quando a chamada vier da futura API ou do Nexo56 Mobile.
