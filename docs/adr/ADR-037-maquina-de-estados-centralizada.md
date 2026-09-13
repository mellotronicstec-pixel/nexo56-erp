# ADR-037 — A máquina de estados da OS vive em um arquivo, e `status` muda por uma porta só

**Status:** Aceito · **Data:** Prompt 08

## Contexto

O Prompt 08 acrescentou oito estados e nove transições à Ordem de Serviço. A
partir daí a pergunta "esta ordem pode ir para aquele estado?" passa a ser feita
em vários lugares: a ficha, para decidir quais botões desenhar; a server action,
para validar o que chegou; o caso de uso, para executar; e, mais tarde, o
Prompt 09 ao aprovar um orçamento e o Prompt 19 ao automatizar.

O jeito natural de responder essa pergunta é um `if (status === …)` onde ela
aparece. É o caminho mais curto e o mais caro: bastam **dois** lugares
divergirem para a mesma OS poder e não poder a mesma coisa, dependendo de por
onde a pessoa entrou. E como a divergência não quebra nada imediatamente, ela
só aparece quando alguém já gravou o estado errado.

Há ainda um segundo risco, específico desta etapa: **ação virando estado**.
"Buscar Peça" e "Informar Ordem Disponível" são verbos, e a tentação de
representá-los como situação é grande porque a tela precisa mostrar alguma coisa
enquanto acontecem.

## Decisão

**Uma autoridade só:**
[`src/modules/service-orders/domain/workflow.ts`](../../src/modules/service-orders/domain/workflow.ts).
Ali estão os estados, a matriz de transições, a permissão de cada transição, o
que exige motivo, a política de follow-up e o texto das recusas. Nenhuma página,
server action, componente, job ou repositório decide — todos perguntam.

**Uma porta só para escrever:**
[`transitionServiceOrder`](../../src/modules/service-orders/application/workflow-service.ts).
Não existe, em lugar nenhum do sistema, um `update(serviceOrders).set({ status })`
fora daquele arquivo.

**Tudo que não está na matriz é proibido.** Não há "qualquer estado vira
qualquer outro", nem estado curinga. `findTransition(from, to)` devolve `null`, e
`explainRefusal(from, to)` devolve o motivo em português.

**Ação não é estado.** As ações vivem em
`application/service-order-actions.ts`. Uma ação pode causar transição
("Informar Ordem Disponível" leva a Aguardando Cliente Retirar) ou não causar
nenhuma ("Buscar Peça" cria tarefa e a ordem continua em Aguardando Peça). A
transição que só existe como consequência de uma ação é marcada `actionOnly` e
**não aparece** no seletor genérico de situação.

## Motivo

Regra centralizada é testável de verdade. A matriz inteira é conferida contra
uma cópia escrita à mão no teste: qualquer atalho novo quebra a suíte, inclusive
um introduzido de boa-fé por outro módulo.

A separação formal que isso preserva — Entity, State, Classification, Action,
Event, Rule, Permission, Automation — não é vocabulário: é o que impede o
módulo de OS de virar um `switch` gigante conforme orçamento, estoque,
financeiro e garantia forem chegando. Cada um deles vai **querer** mudar o
estado da ordem, e todos vão ter de pedir.

`actionOnly` existe por um caso concreto: avisar o cliente antes da limpeza e da
conferência significa o aparelho chegar ao balcão sujo, com o cliente já na
porta. A condição não é "ter permissão", é "a preparação está pronta" — e isso
não cabe numa matriz de transições, cabe na ação.

## Consequências

- Acrescentar um estado é editar um arquivo e escrever um teste; a interface
  passa a oferecê-lo sozinha.
- A ficha **não decide nada**: recebe do servidor as transições já filtradas por
  estado, permissão, feature e unidade, e desenha.
- O que não é possível **não aparece** — botão desabilitado e mudo ensina a
  equipe a ignorar a interface. O que depende de condição aparece com a condição
  escrita.
- O Prompt 09 herda a regra: aprovar um orçamento move a OS chamando
  `transitionServiceOrder`, não gravando `status`.
- Recusas são frases em português, não códigos de erro.

## Alternativas descartadas

**`if (status === …)` onde a pergunta aparece.** Mais curto hoje, divergente
amanhã, e a divergência é silenciosa.

**Tabela de transições no banco.** Daria configuração por tenant que ninguém
pediu, tiraria a matriz do alcance do typecheck e dos testes, e transformaria um
erro de digitação numa transição inexistente em produção.

**Rule engine genérico agora.** É o Prompt 19. Construí-lo antes de haver
automações produziria um motor sem regras para rodar — e a matriz explícita é
mais legível do que qualquer DSL enquanto couber numa tela.

**"Buscar Peça" e "Informar Ordem Disponível" como estados.** Colapsaria ação e
situação: uma ordem só poderia buscar uma peça por vez, buscar a segunda apagaria
o registro da primeira, e a lista de estados cresceria toda vez que alguém
inventasse um verbo novo.
