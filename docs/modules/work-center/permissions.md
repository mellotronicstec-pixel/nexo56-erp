# Central — permissões e Effective Access

## Uma permissão

| Chave              | O que abre        |
| ------------------ | ----------------- |
| `work_center.view` | a tela da Central |

**Não existe `work_center.team_view`.** Quem pode listar as OS da unidade em
`/ordens-de-servico` já vê exatamente os mesmos registros; uma chave extra para
a Central seria teatro de segurança.

## O conteúdo tem dono próprio

Ver a Central **não** é ver as Ordens de Serviço:

| Para ver                  | É preciso                                                |
| ------------------------- | -------------------------------------------------------- |
| a tela                    | `work_center.view` + `operations.work_center`            |
| as filas de OS            | `service_orders.view` + `core.service_orders` na unidade |
| tarefas gerais como sinal | `agenda.view` + `operations.agenda`                      |

Quem tem `work_center.view` sem `service_orders.view` abre a Central e vê um
aviso — **lista vazia e todas as contagens em zero**. Nem pelo cartão o número
vaza. Provado por teste.

## Ações

A Central **não executa nada**. A ação de cada linha é "Abrir OS", e a
permissão de transicionar é verificada na ficha da OS, pelo Prompt 08. Esconder
botão na interface nunca substituiu autorização no servidor — aqui não há nem
botão a esconder.

## Nunca por nome de papel

Nenhuma decisão usa `role === 'technician'` ou equivalente. "Minha visão" usa
`assigned_technician_id = context.userId`, que é vínculo de dado, não rótulo de
cargo.
