# Agenda — permissões

| Chave                        | O que abre                                    |
| ---------------------------- | --------------------------------------------- |
| `agenda.view`                | as três telas e a leitura do read model       |
| `agenda.tasks.create`        | criar tarefa                                  |
| `agenda.tasks.assign`        | atribuir a **outra** pessoa                   |
| `agenda.tasks.manage`        | mexer em tarefa que não é sua, e **cancelar** |
| `agenda.appointments.manage` | criar, reagendar e cancelar compromisso       |

## As decisões que essas cinco chaves carregam

**Pegar a tarefa para si não exige `assign`.** Quem cria trabalho pode assumi-lo.
Passar adiante mexe na fila alheia, e aí sim exige a chave.

**Cancelar exige `manage`, mesmo na própria tarefa.** Concluir registra
trabalho feito; cancelar faz trabalho **desaparecer** da fila. São coisas
diferentes, e a segunda precisa de motivo escrito.

**Quem pode operar uma tarefa:** o responsável e quem criou. Qualquer outra
pessoa precisa de `agenda.tasks.manage`. A regra mora em um lugar só
(`assertCanOperate`) — espalhá-la por caso de uso garantiria que um deles
esquecesse.

## Unidade

A unidade **vem do backend**. A unidade ativa do navegador é conveniência de
tela; a autoridade é `context.authorizedUnitIds`. Uma unidade informada no
formulário só é aceita se estiver nessa lista.

O responsável precisa **existir, ser da empresa, estar ativo e ter acesso à
unidade da tarefa**. Atribuir a quem não opera naquela loja produziria uma
fila que a pessoa nunca vê — e trabalho que ninguém vê é trabalho esquecido.

## Effective Access

Toda autorização passa por `authorize(context, { permission, featureKey: 'operations.agenda', unitId })`.
Permissão **e** feature: ter `agenda.tasks.create` num tenant sem o módulo não
abre nada.

## Respostas que não vazam informação

Tarefa de outra empresa e tarefa inexistente terminam no **mesmo**
`NotFoundError`. A diferença entre as duas respostas contaria ao curioso que a
tarefa existe.
