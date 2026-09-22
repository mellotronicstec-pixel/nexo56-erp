# Agenda — o que ficou de fora, e por quê

Este arquivo existe para que a ausência seja **decisão registrada**, não
esquecimento.

## Recorrência

Uma tarefa que se repete exige decidir: o que acontece quando uma ocorrência é
concluída tarde? O que acontece com o histórico ao editar a série? Como a
exceção de um dia é representada? É um módulo, não um campo.

## Motor de lembretes

Criar "ligar para o cliente" **não liga para ninguém** e não avisa ninguém.
Nada neste módulo envia mensagem. Comunicação é o Prompt 16.

O evento `SERVICE_ORDER_FOLLOW_UP_OVERDUE`, emitido pela varredura do Prompt
08, continua **sem consumidor** — de propósito. Ele é o ponto de conexão
quando a comunicação existir.

## "Realizado" para compromisso

O tempo passar não prova que a visita aconteceu. Marcar automaticamente como
realizado tudo que já passou registraria como atendimento feito justamente o
dia em que ninguém foi. Quando "realizado" for necessário, será um ato humano
explícito, com quem confirmou e quando.

## Job novo

Nenhum. "Atrasada" é derivado ([ADR-074](../../adr/ADR-074-atraso-e-derivado-e-prazo-e-dia.md)),
e um teste de fronteira falha se alguém registrar um job neste módulo.

## Edição de compromisso a partir da lista

A tela oferece criar, reagendar (pelo serviço) e cancelar. Uma ficha de
compromisso com edição completa não foi construída porque a operação ainda não
pediu — e uma tela a mais é uma tela a mais para manter.

## Não antecipado, por instrução explícita

Central de Trabalho (15), Comunicação (16), Portal do cliente (17), BI (18),
Rule Engine (19), IA (20/21), API pública (23), SaaS (24). Nenhum resquício
deles entrou aqui, e o teste de fronteira `agenda-boundary` verifica isso.

## Personalização visual / tema

Não implementada neste prompt, por instrução. A compatibilidade é preservada
pelo uso exclusivo dos tokens do Design System — nenhuma cor literal nas telas
novas.
