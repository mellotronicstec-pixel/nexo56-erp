# Tarefas do fluxo

## O que uma tarefa é — e o que não é

Uma tarefa é **trabalho prático** ligado a uma Ordem de Serviço: limpar o
aparelho, buscar a peça. Ela tem título, prazo, responsável e situação própria.

**Tarefa não é situação da OS.** A ordem pode estar em Aguardando Peça com ou
sem a tarefa de busca aberta. Concluir a preparação **não** muda a situação
sozinha — quem muda a situação é a ação "Informar Ordem Disponível".

Transformar tarefa em status colapsaria as duas coisas: a OS passaria a ter
tantos estados quantas tarefas existirem, e duas tarefas abertas ao mesmo tempo
ficariam impossíveis de representar.

## Os dois tipos

| Tipo                   | Nasce de                                     | Muda o estado? |
| ---------------------- | -------------------------------------------- | -------------- |
| `delivery_preparation` | entrar em Aguardando Preparação para Entrega | não            |
| `part_pickup`          | ação "Buscar Peça" (só em Aguardando Peça)   | não            |

## Preparação para entrega

Criada **dentro da transação da transição**, não por handler de evento: a tarefa
precisa existir no instante em que a ordem chega ao estado que a exige. Se
dependesse de entrega de evento, haveria uma janela em que a bancada teria
trabalho a fazer e nenhuma tarefa dizendo isso.

Texto oficial, não parafraseado — é o que a pessoa lê na bancada:

> **Preparar equipamento para entrega**
> Realizar limpeza final, conferência estética e preparação do equipamento para
> entrega ao cliente.

Prazo: **+2 dias corridos**.

**Responsável: quem abriu a ordem.** Quando esse usuário não existe mais ou
perdeu acesso à unidade, a tarefa fica **sem responsável** e aparece nas
pendências da unidade — melhor do que atribuir a alguém escolhido pelo sistema,
que ninguém saberia que recebeu.

Não há tabela de checklist separada. A tarefa com o texto oficial **é** a
preparação; duplicar o checklist do recebimento criaria duas verdades sobre a
mesma conferência.

## Buscar peça

Registra a busca. **Não muda o estado**: a ordem continua em Aguardando Peça,
porque buscar a peça não é o mesmo que tê-la.

A observação ("qual peça e onde buscar") é texto livre. A regra original prevê
mostrar locais de retirada — Estoque e Compras são os Prompts 10 e 11, e
inventar uma lista de fornecedores aqui criaria dado falso que alguém usaria. A
estrutura aceita um catálogo quando ele existir.

## Idempotência: o truque do `open_marker`

```sql
UNIQUE uq_so_task_open (service_order_id, kind, open_marker)
```

`open_marker` vale `1` enquanto a tarefa está aberta e `NULL` depois. No MySQL
cada `NULL` é distinto num índice UNIQUE, então:

- **duas tarefas abertas do mesmo tipo na mesma ordem: impossível** — recusado
  pelo banco, não só pela aplicação;
- tarefas encerradas se acumulam à vontade, e a próxima abre normalmente.

É o mesmo padrão do contato principal do cliente (Prompt 05).

A aplicação verifica antes e simplesmente **não faz nada** quando a tarefa
aberta já existe — não é erro: o estado desejado já é o estado atual.
Reprocessar um evento ou clicar duas vezes não enche a bancada de tarefas
idênticas.

## Conclusão

`WHERE status = 'open'` no próprio `UPDATE`: dois cliques simultâneos em
"Concluir" não produzem dois registros de conclusão. A segunda tentativa recebe
_"Esta tarefa já foi encerrada."_

Conclusão grava `completed_at` e `completed_by`, entra na linha do tempo da
ordem, é auditada e publica `SERVICE_ORDER_TASK_COMPLETED`.

## A tarefa de peça NÃO se fecha sozinha

Quando a peça chega e a ordem volta para Aguardando Conserto, a tarefa "Buscar
peça" **continua aberta**. Quem fez a busca conclui a tarefa.

A alternativa — fechar automaticamente na transição — atribuiria a conclusão a
ninguém, e a trilha registraria uma tarefa concluída sem responsável. Como o
trabalho pode ter sido de outra pessoa, e a peça pode ter chegado por outro
caminho, a conclusão continua sendo um ato de alguém.

**Custo conhecido:** uma tarefa esquecida fica no painel de pendências da
unidade até que alguém a encerre. É ruído, e é deliberado — preferível a
inventar uma regra de fechamento automático que ninguém pediu.

## Encerramento da ordem

Finalizar ou cancelar a OS **cancela as tarefas que ficaram abertas** — ordem
encerrada não deixa trabalho aberto atrás de si. Cada tarefa cancelada gera seu
próprio registro de auditoria: "a ordem foi cancelada" não explica, meses
depois, por que a tarefa de preparação que estava na bancada de alguém sumiu.

## Escopo

A tarefa pertence à **unidade da ordem**, com FK composta `(unit_id, tenant_id)`.
Tarefa de outra empresa ou de outra unidade responde **"não encontrada"**.
Coberto por teste.
