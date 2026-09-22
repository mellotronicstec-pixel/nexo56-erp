# Central — o que ficou de fora, e por quê

Registrar a ausência como decisão, não como esquecimento.

## Ações rápidas

A Central **não executa nenhuma ação**. A ação primária é "Abrir OS".

Foi uma escolha, não uma limitação técnica. O critério do próprio prompt exige
que uma ação rápida só exista quando é frequente, inequívoca, já suportada pelo
domínio e sem formulário complexo. As candidatas não passaram:

- **transicionar a OS** — quase toda transição exige motivo, confirmação ou
  depende de pré-condição (preparação concluída, por exemplo). Reproduzir isso
  numa linha de lista seria reimplementar a ficha da OS pela metade;
- **concluir tarefa** — a Central mostra tarefa como _sinal_ ("tarefa
  atrasada"), não como item acionável; concluir a tarefa certa exige ver qual é,
  e isso é `/minhas-tarefas`, do Prompt 14;
- **pegar para mim** — não existe serviço de auto-atribuição de OS. Inventar um
  só para ter botão seria criar semântica nova num prompt de leitura.

Quando alguma dessas ganhar um serviço oficial com semântica inequívoca, a
Central pode delegar a ele sem mudar nada da arquitetura.

## Auto-atribuição de OS

`assignTechnician` existe (Prompt 08) mas exige permissão de atribuição e
escolher uma pessoa. Um "pegar para mim" seria um caso particular disso — vale
a pena, mas é decisão de produto, não de tela.

## Compromissos

A Central **não é calendário**. Compromissos continuam na Agenda. Mostrar os
próximos aqui poluiria a tela sem responder "por onde começo".

## Sinais de Estoque, Compras e Financeiro

Não projetados. A prioridade declarada do prompt é OS + tarefas + follow-ups, e
os sinais desses módulos só valeriam a pena com projeção segura e barata:

- **Estoque** — "tem peça reservada?" exigiria ler reservas por OS; útil, mas
  duplicaria leitura do módulo proprietário sem ganho claro na fila;
- **Compras** — nem toda OS em Aguardando Peça tem compra aberta, e sugerir que
  tem seria mentir;
- **Financeiro** — a Central **não é** painel financeiro, por decisão explícita.

Nenhum deles quebra a Central quando desligado: ela simplesmente não os
menciona.

## Tempo no estado

"Há X dias neste estado" **não** foi implementado. `updated_at` muda por outros
motivos e não serve como momento de entrada no estado. A derivação correta viria
da linha do tempo da OS (`service_order_timeline`), e fazê-la bem exige decidir
o que mostrar quando a OS voltou a um estado anterior.

Preferi não implementar a derivar de um campo que mentiria de vez em quando.

## Central como home operacional

A rota é `/central-de-trabalho` e o item é o primeiro do menu. A home global
**não foi alterada**: mudá-la afeta todo mundo, inclusive quem não tem a feature
ligada. Quando fizer sentido, é uma decisão de produto isolada.

## Minha Bancada / Nexo56 Mobile

Preparado, não implementado. O read model é compacto, a autorização é
centralizada e a composição vive em serviço reaproveitável — não em componente
React. Não há dependência de desktop.

O que falta para o Mobile: uma forma de resposta mais enxuta (a projeção atual
carrega campos que só o desktop usa) e auto-atribuição.

## Não antecipado, por instrução explícita

Comunicação (16), Portal (17), BI (18), Rule Engine (19), IA (20–22), API
pública (23), SaaS (24). Um teste de fronteira falha se qualquer resquício
aparecer no módulo.
