# Matriz de acesso — Nexo56

**Versão 1.0 — Prompt 03.** Documento versionado: cada prompt que acrescenta
permissões acrescenta linhas aqui e sobe a versão. Linhas não são reescritas
silenciosamente — mudança de regra vira nova versão com a data.

| Versão | Data      | Mudança                                                      |
| ------ | --------- | ------------------------------------------------------------ |
| 1.0    | Prompt 03 | Primeira versão: capacidades estruturais e escopo de unidade |

Conceitos e implementação: [access-control.md](access-control.md).

---

## 1. Capacidades por permissão

Legenda de escopo: **T** = ação de nível tenant (papel TENANT);
**U** = ação de unidade (papel TENANT ou papel UNIT daquela unidade).

| Permissão                          | Permite                                                   | Escopo | Risco |
| ---------------------------------- | --------------------------------------------------------- | ------ | ----- |
| `admin.access`                     | abrir a área de administração                             | T      | —     |
| `users.view`                       | listar e abrir usuários da empresa                        | T      | —     |
| `users.manage`                     | criar, editar, ativar e desativar usuários                | T      | alto  |
| `users.manage_access`              | vincular unidades e atribuir/revogar perfis               | T      | alto  |
| `users.reset_password`             | gerar código de redefinição de senha de terceiro          | T      | alto  |
| `sessions.revoke`                  | encerrar sessões de outro usuário                         | T      | alto  |
| `roles.view`                       | consultar perfis e suas permissões                        | T      | —     |
| `roles.manage`                     | criar, renomear e excluir perfis                          | T      | alto  |
| `roles.manage_permissions`         | alterar **quais** permissões um perfil concede            | T      | alto  |
| `units.view`                       | consultar unidades                                        | T      | —     |
| `units.manage`                     | criar e alterar unidades                                  | T      | alto  |
| `features.view`                    | consultar módulos disponíveis                             | T      | —     |
| `features.manage`                  | ativar e desativar módulos da empresa                     | T      | alto  |
| `audit.view`                       | consultar a trilha de auditoria                           | T      | —     |
| `customers.view`                   | listar e abrir clientes                                   | T      | —     |
| `customers.manage`                 | cadastrar e corrigir clientes                             | T      | médio |
| `customers.change_status`          | ativar e inativar cliente                                 | T      | médio |
| `equipment.view`                   | consultar equipamentos e suas fotos                       | T      | —     |
| `equipment.manage`                 | cadastrar e corrigir a identificação do aparelho          | T      | médio |
| `equipment_intake.view`            | consultar os recebimentos **da unidade**                  | **U**  | —     |
| `equipment_intake.create`          | registrar a entrada de um aparelho na unidade             | **U**  | médio |
| `equipment_intake.manage_media`    | anexar e remover fotos                                    | **U**  | médio |
| `service_orders.view`              | consultar Ordens de Servico da unidade                    | **U**  | —     |
| `service_orders.create`            | abrir uma Ordem de Servico                                | **U**  | médio |
| `service_orders.update`            | corrigir o relato e as observacoes de abertura            | **U**  | médio |
| `service_orders.transition`        | mover a Ordem de Servico pelo fluxo                       | **U**  | médio |
| `service_orders.complete`          | finalizar a Ordem de Servico                              | **U**  | alto  |
| `service_orders.cancel`            | cancelar a Ordem de Servico                               | **U**  | alto  |
| `service_orders.assign_technician` | definir o tecnico responsavel                             | **U**  | médio |
| `service_orders.manage_follow_up`  | reagendar o acompanhamento                                | **U**  | médio |
| `service_orders.manage_tasks`      | criar e concluir tarefas do fluxo                         | **U**  | médio |
| `quotes.view`                      | consultar orcamentos da unidade                           | **U**  | —     |
| `quotes.create`                    | abrir orcamento ou revisao                                | **U**  | médio |
| `quotes.update_draft`              | alterar itens e valores do rascunho                       | **U**  | médio |
| `quotes.send`                      | formalizar a proposta e mover a OS                        | **U**  | alto  |
| `quotes.approve`                   | registrar a aprovacao do cliente                          | **U**  | alto  |
| `quotes.reject`                    | registrar a recusa do cliente                             | **U**  | alto  |
| `quotes.cancel`                    | descartar rascunho ou retirar proposta                    | **U**  | médio |
| `inventory.view`                   | consultar pecas, saldos, reservas e movimentacoes         | **U**  | —     |
| `inventory.catalog_manage`         | criar, editar e inativar pecas; estoque minimo            | **T**  | médio |
| `inventory.locations_manage`       | criar, editar e inativar localizacoes da unidade          | **U**  | baixo |
| `inventory.receive`                | registrar entrada de estoque                              | **U**  | médio |
| `inventory.issue`                  | registrar saida e consumir reserva                        | **U**  | médio |
| `inventory.reserve`                | reservar peca para OS e liberar reserva                   | **U**  | médio |
| `inventory.transfer`               | transferir entre unidades (autoriza nas DUAS)             | **U**  | alto  |
| `inventory.adjust`                 | reescrever o saldo mediante motivo                        | **U**  | alto  |
| `suppliers.view`                   | consultar fornecedores                                    | **T**  | —     |
| `suppliers.manage`                 | cadastrar, editar e inativar fornecedor                   | **T**  | baixo |
| `purchases.view`                   | consultar necessidades, pedidos e custo pago              | **U**  | —     |
| `purchases.create`                 | registrar necessidade e abrir pedido                      | **U**  | baixo |
| `purchases.update`                 | editar o rascunho: itens, custos e observacoes            | **U**  | baixo |
| `purchases.approve`                | aprovar a despesa e registrar o pedido realizado          | **U**  | médio |
| `purchases.receive`                | registrar a chegada — **cria movimento de estoque**       | **U**  | médio |
| `purchases.cancel`                 | cancelar pedido, com motivo                               | **U**  | médio |
| `ai.use`                           | usar Nexo56 AI (sugestão de escrita) num campo autorizado | **U**  | baixo |

Até o Prompt 04 todas as capacidades eram de nível **tenant** — o catálogo
continha apenas administração estrutural. O Prompt 06 trouxe as primeiras de
nível **unidade**: recebimento é um acontecimento que pertence a um lugar, e as
três permissões de `equipment_intake` valem para a unidade ativa. Clientes e
Equipamentos continuam de nível tenant, porque a entidade em si atravessa as
unidades (ADR-026, ADR-029).

O Prompt 07 acrescentou as três primeiras da Ordem de Serviço, também de nível
unidade: a OS é o trabalho assumido por uma loja. O Prompt 08 acrescentou as
seis do **workflow**, todas de unidade — e com uma diferença que importa:

> A permissão de workflow é avaliada na unidade **da ordem**, não na unidade
> ativa da sessão.

Alguém com acesso a duas lojas não deve conseguir mover o trabalho da loja B por
estar com a loja A selecionada no seletor. Abertura e correção continuam usando
a unidade ativa, porque ali a unidade **é** o destino do que se cria.

Finalizar e cancelar têm permissão própria porque são irreversíveis: quem move o
trabalho pela bancada não necessariamente encerra o atendimento.

O Prompt 09 acrescentou as sete de **Orçamentos**, também de unidade e também
avaliadas na unidade **da ordem**. O corte separa quem **monta** a proposta de
quem a **formaliza** e de quem **registra a decisão do cliente** — numa
assistência isso costuma ser gente diferente.

Enviar e aprovar exigem, além da permissão de orçamento,
`service_orders.transition`: as duas ações **movem a Ordem de Serviço**, e a
permissão descreve o que de fato acontece.

O Prompt 12 acrescentou as dez de **Financeiro**, sob a feature OPCIONAL
`finance.core`. O corte separa três decisões diferentes: **consultar**
(`finance.view`), **criar a obrigação** (`finance.receivables.manage` /
`finance.payables.manage`) e **registrar o fato** (`finance.receive` /
`finance.pay`). Criar um título é decisão comercial — quanto cobrar, em quantas
vezes; liquidar é registro — o dinheiro entrou. O atendente dá baixa o dia
inteiro e não deveria emitir uma cobrança de R$ 5.000.

`finance.reverse` é separada porque estornar desfaz um fato já registrado, e as
três do caixa (`open`, `close`, `adjust`) porque quem abre a gaveta de manhã não
é necessariamente quem tem autoridade para uma sangria.

Todas são avaliadas **na unidade DO TÍTULO**, nunca na unidade ativa da sessão.

O Prompt 13 acrescentou as dez de **Garantias**, sob a feature OPCIONAL
`operations.warranties`. O corte separa atos que costumam ser de pessoas
diferentes: **consultar** (`warranties.view`), **preparar**
(`warranties.create`), **emitir** (`warranties.issue`), **registrar retorno**
(`warranties.return.create`), **reclassificar** (`warranties.reclassify`),
**encerrar** (`warranties.cancel`, `warranties.revoke`), **ver e lançar custo**
(`warranties.costs.view`, `warranties.costs.manage`) e **definir o padrão da
casa** (`warranties.settings.manage`).

Criar rascunho é trabalho de balcão; **emitir** é o ato que passa a valer contra
a loja. `warranties.reclassify` é separada porque contraria uma decisão anterior
da própria empresa e tira do cliente um conserto que ele veio buscar de graça —
exige autoridade técnica, verificada **pela chave**, nunca pelo nome textual do
cargo. As duas de custo são separadas de `warranties.view` porque o atendente
precisa saber se a cobertura vale e **não** precisa saber a margem da loja.

Todas são avaliadas **na unidade DA GARANTIA**, nunca na unidade ativa da
sessão.

O Prompt 20 acrescentou `ai.use`, sob a feature OPCIONAL `ai.writing`
(dependente de `ai.core`). `ai.use` **nunca substitui** a permissão de
domínio do campo — usar Nexo56 AI em `service_orders.internal_notes` exige
`ai.use` **e** `service_orders.update`; em `quotes.customer_notes`, `ai.use`
**e** `quotes.update_draft`. As duas são avaliadas **na unidade DA
ENTIDADE** (a OS ou o orçamento), nunca na unidade ativa da sessão — mesmo
padrão das demais linhas de unidade desta tabela. Um usuário com `ai.use`
mas sem a permissão de domínio do campo não ganha capacidade de editar: se
o campo não pode ser salvo, "Usar texto" nem é oferecido pela interface.

---

## 2. Perfis de origem

| Perfil        | `is_system` | Permissões                   | Pode ser excluído |
| ------------- | ----------- | ---------------------------- | ----------------- |
| Administrador | sim         | todas                        | não               |
| Atendente     | não         | nenhuma (aguarda os módulos) | sim               |
| Técnico       | não         | nenhuma (aguarda os módulos) | sim               |
| Financeiro    | não         | nenhuma (aguarda os módulos) | sim               |

---

## 3. Rotas e o que cada uma exige

| Rota                                           | Exige                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `/login`                                       | — (pública)                                                           |
| `/`                                            | sessão válida                                                         |
| `/minha-conta`                                 | sessão válida (sem permissão)                                         |
| `/administracao/usuarios`                      | `users.view`                                                          |
| `/administracao/usuarios/[userId]`             | `users.view` + alvo no mesmo tenant                                   |
| `/administracao/perfis`                        | `roles.view`                                                          |
| `/administracao/perfis/[roleId]`               | `roles.view` + alvo no mesmo tenant                                   |
| `/administracao/unidades`                      | `units.view` + feature `platform.multi_unit`                          |
| `/administracao/modulos`                       | `features.view`                                                       |
| `/administracao/auditoria`                     | `audit.view`                                                          |
| `/clientes`                                    | `customers.view` + feature `core.customers`                           |
| `/clientes/novo`                               | `customers.manage`                                                    |
| `/clientes/[customerId]`                       | `customers.view` + alvo no mesmo tenant                               |
| `/clientes/[customerId]/editar`                | `customers.manage` + alvo no mesmo tenant                             |
| `/equipamentos`                                | `equipment.view` + feature `core.equipment`                           |
| `/equipamentos/novo`                           | `equipment.manage`                                                    |
| `/equipamentos/[equipmentId]`                  | `equipment.view` + alvo no mesmo tenant                               |
| `/equipamentos/[equipmentId]/editar`           | `equipment.manage` + alvo no mesmo tenant                             |
| `/recebimentos`                                | `equipment_intake.view` + unidade ativa                               |
| `/recebimentos/novo`                           | `equipment_intake.create` + unidade ativa                             |
| `/api/midia/[mediaId]`                         | sessão + `equipment.view` + mídia do mesmo tenant                     |
| `/ordens-de-servico`                           | `service_orders.view` + feature `core.service_orders` + unidade ativa |
| `/ordens-de-servico/nova`                      | `service_orders.create` + unidade ativa                               |
| `/ordens-de-servico/[id]`                      | `service_orders.view` + alvo na unidade autorizada                    |
| `/ordens-de-servico/[id]/editar`               | `service_orders.update` + alvo na unidade autorizada                  |
| `/ordens-de-servico/[id]/orcamentos/[quoteId]` | `quotes.view` + feature `core.quotes` + alvo na unidade autorizada    |
| `/estoque`                                     | `inventory.view` + feature `operations.inventory` + unidade ativa     |
| `/estoque/nova-peca`                           | `inventory.catalog_manage` (escopo TENANT)                            |
| `/estoque/[partId]`                            | `inventory.view` + peça do mesmo tenant                               |
| `/estoque/localizacoes`                        | `inventory.view`; gerenciar exige `inventory.locations_manage`        |
| `/fornecedores`                                | `suppliers.view` + feature `operations.purchasing`                    |
| `/fornecedores/novo-fornecedor`                | `suppliers.manage` (escopo TENANT)                                    |
| `/fornecedores/[supplierId]`                   | `suppliers.view` + fornecedor do mesmo tenant                         |
| `/compras`                                     | `purchases.view` + feature `operations.purchasing` + unidade ativa    |
| `/compras/novo-pedido`                         | `purchases.create` + unidade ativa                                    |
| `/compras/necessidades`                        | `purchases.view` + unidade ativa                                      |
| `/compras/[purchaseOrderId]`                   | `purchases.view` + pedido em unidade autorizada                       |
| `/financeiro`                                  | `finance.view` + feature `finance.core` + unidade ativa               |
| `/financeiro/contas-a-receber`                 | `finance.view` + unidade ativa                                        |
| `/financeiro/contas-a-pagar`                   | `finance.view` + unidade ativa                                        |
| `/financeiro/novo-lancamento`                  | `finance.view`; lançar exige `finance.*.manage`                       |
| `/financeiro/titulos/[titleId]`                | `finance.view` + título em unidade autorizada                         |
| `/financeiro/caixa`                            | `finance.cash.open` + unidade ativa                                   |
| `/financeiro/configuracoes`                    | `finance.settings.manage`                                             |
| `/garantias`                                   | `warranties.view` + feature `operations.warranties`                   |
| `/garantias/lista`                             | `warranties.view`                                                     |
| `/garantias/[warrantyId]`                      | `warranties.view` + garantia em unidade autorizada                    |
| `/garantias/retornos`                          | `warranties.view`                                                     |
| `/garantias/novo-retorno`                      | `warranties.return.create`                                            |
| `/garantias/politicas`                         | `warranties.settings.manage`                                          |
| `/garantias/certificado/[token]`               | `warranties.view` + certificado do mesmo tenant                       |
| `/acesso-negado`                               | — (página de explicação)                                              |

**`purchases.receive` é verificada na unidade DO PEDIDO**, não na unidade ativa
da sessão: quem recebe cria saldo naquela unidade e só naquela. É a mesma razão
pela qual `inventory.transfer` autoriza nas duas pontas.

Receber mercadoria de compra **não exige `inventory.receive`**: a entrada é
feita pela primitiva do Inventory, que não reautoriza. Exigir também a permissão
genérica de estoque daria ao balconista mais acesso, não menos — ele passaria a
poder dar entrada em qualquer peça por qualquer motivo.

Cada Server Action revalida a permissão **de escrita** correspondente, que é
sempre mais estrita que a de leitura da página. Abrir a ficha de um usuário
exige `users.view`; conceder-lhe um perfil exige `users.manage_access`.

---

## 4. Exemplos permitidos

| #   | Situação                                                                                            | Resultado |
| --- | --------------------------------------------------------------------------------------------------- | --------- |
| 1   | Administrador da Empresa A abre a lista de usuários da Empresa A                                    | permitido |
| 2   | Usuário com `users.view` abre a ficha de acesso de um colega do mesmo tenant                        | permitido |
| 3   | Usuário com `users.manage_access` vincula um colega à Unidade Norte                                 | permitido |
| 4   | Usuário com `users.manage_access` atribui "Técnico" **só na Unidade Norte** a quem tem vínculo lá   | permitido |
| 5   | Usuário com papel TENANT "Financeiro" opera na Unidade Norte **e** na Unidade Sul                   | permitido |
| 6   | Qualquer usuário autenticado abre `/minha-conta` e encerra as próprias outras sessões               | permitido |
| 7   | Usuário troca a própria senha informando a senha atual correta                                      | permitido |
| 8   | Usuário com `sessions.revoke` encerra as sessões de um colega do mesmo tenant                       | permitido |
| 9   | Usuário com `roles.manage_permissions` concede a um perfil uma permissão **que ele mesmo tem**      | permitido |
| 10  | Atendente da Unidade Norte abre o equipamento cadastrado na Unidade Sul (mesmo tenant)              | permitido |
| 11  | Usuário com `equipment_intake.create` e unidade ativa registra um recebimento                       | permitido |
| 12  | Usuário com `equipment.view` carrega a foto do equipamento pela rota `/api/midia/[mediaId]`         | permitido |
| 13  | Atendente com `service_orders.create` e unidade ativa abre uma OS a partir de um recebimento        | permitido |
| 14  | Usuário com papel só na Unidade Norte abre OS de um recebimento registrado na Norte                 | permitido |
| 15  | Reenviar o mesmo formulário de abertura devolve a MESMA OS, sem criar a segunda                     | permitido |
| 16  | Usuário com `service_orders.transition` move a OS de Aguardando Parecer para Aguardando Conserto    | permitido |
| 17  | Papel TENANT com `service_orders.transition` move OS de qualquer unidade que a pessoa acesse        | permitido |
| 18  | Usuário com `service_orders.manage_tasks` conclui a tarefa de preparação da própria unidade         | permitido |
| 19  | Registrar busca de peça duas vezes: a segunda não cria tarefa duplicada e não é erro                | permitido |
| 20  | Técnico com `quotes.create` e `quotes.update_draft` monta a proposta sem poder enviá-la             | permitido |
| 21  | Atendente com `quotes.send` + `service_orders.transition` formaliza e a OS vai para aprovação       | permitido |
| 22  | Criar revisão de um orçamento recusado, mantendo a recusa no histórico                              | permitido |
| 23  | Item de orçamento com valor zero (cortesia)                                                         | permitido |
| 24  | Atendente com `finance.receive` registra R$ 600 num título de R$ 1.000 (pagamento parcial)          | permitido |
| 25  | Reenviar o mesmo formulário de liquidação devolve a MESMA liquidação, sem lançar em duplicidade     | permitido |
| 26  | Duas liquidações de PARCELAS DIFERENTES do mesmo título, em paralelo: as duas passam e a soma fecha | permitido |
| 27  | Usuário com `finance.view` vê o saldo devedor do cliente sem poder emitir cobrança                  | permitido |
| 28  | Gerar a cobrança da mesma OS duas vezes: devolve a mesma cobrança, com aviso                        | permitido |
| 29  | Pedido de compra com duas entregas parciais gera DUAS contas a pagar que somam o recebido           | permitido |
| 30  | Atendente com `warranties.return.create` registra retorno de garantia VENCIDA, sem criar OS         | permitido |
| 31  | Reenviar o mesmo formulário de retorno devolve o MESMO retorno e a MESMA OS                         | permitido |
| 32  | Dois retornos com chaves DIFERENTES na mesma garantia geram dois atendimentos                       | permitido |
| 33  | Usuário com `warranties.view` lê a cobertura sem ver o custo da loja                                | permitido |
| 34  | Gerar o certificado duas vezes devolve o mesmo documento, com o mesmo token                         | permitido |
| 35  | A MESMA OS recebe duas garantias de escopos diferentes (mão de obra e peça)                         | permitido |

---

## 5. Exemplos negados

| #   | Tentativa                                                                             | Motivo                                                            | Resposta                                   |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| 1   | Sem sessão, acessar `/administracao/usuarios` por URL direta                          | `NOT_AUTHENTICATED`                                               | redireciona para `/login`                  |
| 2   | Com sessão, sem `users.view`, acessar `/administracao/usuarios`                       | `PERMISSION_DENIED`                                               | `/acesso-negado`                           |
| 3   | Abrir a ficha de um usuário **de outra empresa** usando o ID real                     | `RESOURCE_OUT_OF_SCOPE`                                           | **404 "registro não encontrado"**          |
| 4   | Atribuir a si mesmo um perfil com mais permissões                                     | autoescalonamento                                                 | erro de regra de negócio                   |
| 5   | Conceder a um perfil uma permissão que o próprio concedente **não** possui            | delegação além do próprio                                         | erro de regra de negócio                   |
| 6   | Atribuir perfil por unidade a quem **não tem vínculo** naquela unidade                | vínculo ausente                                                   | erro; e o banco recusaria a linha          |
| 7   | Revogar o papel do **último** administrador da empresa                                | tenant sem administrador                                          | erro de regra de negócio                   |
| 8   | Desativar o **último** administrador da empresa                                       | tenant sem administrador                                          | erro de regra de negócio                   |
| 9   | Excluir o perfil `Administrador` (`is_system`)                                        | perfil estrutural                                                 | erro de regra de negócio                   |
| 10  | Trocar para uma unidade **não autorizada** enviando o ID no formulário                | `UNIT_NOT_AUTHORIZED`                                             | ignorado em silêncio, com log              |
| 11  | Usar permissão de papel UNIT (só na Unidade Norte) para uma ação de **nível tenant**  | `PERMISSION_DENIED`                                               | erro de autorização                        |
| 12  | Usar permissão de papel UNIT da Unidade Norte para agir **na Unidade Sul**            | `PERMISSION_DENIED`                                               | erro de autorização                        |
| 13  | Agir numa unidade sem tê-la selecionada, quando a ação é de unidade                   | `UNIT_REQUIRED`                                                   | erro de autorização                        |
| 14  | Usar sessão de usuário **desativado** depois da desativação                           | contexto inválido                                                 | redireciona para `/login`                  |
| 15  | Usar sessão de empresa **suspensa**                                                   | contexto inválido                                                 | redireciona para `/login`                  |
| 16  | Reusar um código de redefinição de senha já consumido                                 | token usado                                                       | erro de autenticação                       |
| 17  | Usar um código de redefinição expirado (> 60 min)                                     | token expirado                                                    | erro de autenticação                       |
| 18  | Trocar a própria senha informando a senha atual errada                                | senha incorreta                                                   | erro de autenticação                       |
| 19  | Encerrar a sessão de outra pessoa pela tela `/minha-conta`                            | fora do escopo do usuário                                         | "registro não encontrado"                  |
| 20  | 6ª tentativa de login com senha errada em 5 minutos                                   | rate limit                                                        | erro com `Retry-After`                     |
| 21  | Acessar `/administracao/unidades` com `platform.multi_unit` desativada para a empresa | `FEATURE_UNAVAILABLE`                                             | `/acesso-negado`                           |
| 22  | `INSERT` direto em SQL vinculando usuário da Empresa A a unidade da Empresa B         | FK composta                                                       | `ERROR 1452` do InnoDB                     |
| 23  | Ver o recebimento da Unidade Sul estando com a Unidade Norte ativa                    | escopo de unidade                                                 | não aparece na consulta                    |
| 24  | Registrar recebimento **sem unidade ativa**                                           | `UNIT_REQUIRED`                                                   | erro de autorização                        |
| 25  | Enviar `unitId` de outra unidade no formulário de recebimento                         | valor ignorado                                                    | usa `context.activeUnitId`                 |
| 26  | Abrir `/api/midia/[mediaId]` **sem sessão**                                           | sem autenticação                                                  | `401`, sem corpo                           |
| 27  | Abrir mídia de outro tenant com sessão válida                                         | fora do tenant                                                    | `404` (nunca 403)                          |
| 28  | Enviar um `.php` renomeado para `.jpg` como foto                                      | magic bytes                                                       | recusado com mensagem em português         |
| 29  | `INSERT` direto ligando equipamento da Empresa B a cliente da Empresa A               | FK composta                                                       | `ERROR 1452` do InnoDB                     |
| 30  | Ver OS da Unidade Sul estando com a Unidade Norte ativa                               | escopo de unidade                                                 | não aparece; ficha "não encontrada"        |
| 31  | Abrir OS a partir de recebimento registrado em OUTRA unidade                          | coerência de unidade                                              | erro de regra + FK composta                |
| 32  | Abrir uma segunda OS para o mesmo recebimento                                         | UNIQUE de recebimento                                             | erro de regra, com link para a existente   |
| 33  | `INSERT` direto com número de OS repetido na mesma empresa                            | UNIQUE `(tenant, number)`                                         | `ERROR 1062` do InnoDB                     |
| 34  | Abrir OS sem unidade ativa                                                            | `UNIT_REQUIRED`                                                   | erro de autorização                        |
| 35  | Enviar `customerId` de outro cliente no formulário de abertura                        | valor ignorado                                                    | cliente vem do equipamento                 |
| 36  | Mover OS da Unidade Sul com papel de transição concedido só na Unidade Norte          | escopo da **ordem**                                               | erro de autorização                        |
| 37  | Finalizar a OS tendo só `service_orders.transition`                                   | `PERMISSION_DENIED`                                               | erro de autorização                        |
| 38  | Cancelar a OS tendo só `service_orders.transition`                                    | `PERMISSION_DENIED`                                               | erro de autorização                        |
| 39  | Cancelar a OS sem escrever o motivo                                                   | motivo obrigatório                                                | erro de validação                          |
| 40  | Transição não prevista na matriz (ex.: Aguardando Peça → Reparo Concluído)            | regra de workflow                                                 | recusa explicada em português              |
| 41  | Qualquer transição a partir de OS Finalizada ou Cancelada                             | estado terminal                                                   | recusa explicada em português              |
| 42  | Ir para Aguardando Cliente Retirar pelo seletor genérico de situação                  | transição `actionOnly`                                            | recusa: só pela ação correspondente        |
| 43  | "Informar Ordem Disponível" antes de concluir a preparação                            | condição da ação                                                  | recusa explicada em português              |
| 44  | Gravar uma transição com a versão que já ficou velha (outra pessoa gravou antes)      | conflito de versão                                                | aviso para recarregar; nada é gravado      |
| 45  | Atribuir como técnico alguém sem vínculo com a unidade da ordem, ou inativo           | vínculo/situação                                                  | erro de regra de negócio                   |
| 46  | Atribuir como técnico alguém de **outra empresa**, com o UUID em mãos                 | fora do tenant                                                    | erro de regra de negócio                   |
| 47  | Concluir tarefa de outra unidade ou de outra empresa pelo UUID                        | escopo                                                            | "não encontrada"                           |
| 48  | Concluir a mesma tarefa duas vezes                                                    | tarefa já encerrada                                               | erro de regra de negócio                   |
| 49  | Registrar busca de peça fora de Aguardando Peça                                       | estado incompatível                                               | erro de regra de negócio                   |
| 50  | `INSERT` direto de duas tarefas abertas do mesmo tipo na mesma OS                     | UNIQUE com `open_marker`                                          | `ERROR 1062` do InnoDB                     |
| 51  | Enviar orçamento sem `service_orders.transition`                                      | a ação move a OS                                                  | erro de autorização; nada é gravado        |
| 52  | Enviar orçamento com a OS em estado incompatível                                      | regra de workflow                                                 | recusa explicada; nada é gravado           |
| 53  | Enviar orçamento sem nenhum item                                                      | proposta vazia                                                    | erro de regra de negócio                   |
| 54  | Editar itens ou valores de um orçamento já enviado                                    | imutabilidade pós-envio                                           | erro; oriente a criar revisão              |
| 55  | Aprovar um orçamento que ainda é rascunho                                             | matriz do orçamento                                               | recusa explicada em português              |
| 56  | Registrar recusa sem escrever o motivo                                                | motivo obrigatório                                                | erro de validação                          |
| 57  | Duas aprovações simultâneas do mesmo orçamento                                        | `version` + compare-and-swap                                      | uma vence; a outra recebe aviso            |
| 58  | `INSERT` direto de duas propostas vivas na mesma OS                                   | UNIQUE com `active_marker`                                        | `ERROR 1062` do InnoDB                     |
| 59  | `INSERT` direto de orçamento na unidade B para OS da unidade A                        | FK `(service_order_id, unit_id)`                                  | `ERROR 1452` do InnoDB                     |
| 60  | Operar orçamento com papel concedido só na outra unidade                              | escopo da **ordem**                                               | erro de autorização                        |
| 61  | Abrir orçamento de outra empresa com o UUID em mãos                                   | fora do tenant                                                    | "não encontrado" (nunca 403)               |
| 62  | Item com valor negativo, quantidade zero ou desconto maior que a linha                | validação de domínio                                              | erro de validação em português             |
| 63  | Liquidar R$ 600 num saldo de R$ 400                                                   | `WHERE settled_amount + :q <= amount`                             | `affectedRows = 0` → conflito em português |
| 64  | Duas pessoas liquidando a MESMA parcela ao mesmo tempo, somando mais que o saldo      | idem, no banco                                                    | uma passa, a outra recebe conflito         |
| 65  | Estornar duas vezes o mesmo lançamento                                                | `UNIQUE (reversal_of_movement_id)` + `WHERE status = 'confirmed'` | a segunda é recusada                       |
| 66  | Cancelar título que já recebeu pagamento                                              | `AND settled_amount = '0.00'` no `WHERE`                          | recusa: estorne primeiro                   |
| 67  | `UPDATE` ou `DELETE` em `financial_movements`                                         | razão append-only                                                 | **build vermelho** no teste de boundary    |
| 68  | Abrir o segundo caixa na mesma conta                                                  | `UNIQUE (financial_account_id, open_marker)`                      | `ER_DUP_ENTRY` → conflito                  |
| 69  | Liquidar em conta do tipo dinheiro sem caixa aberto                                   | regra do caso de uso                                              | recusa, e a tela avisa **antes** do envio  |
| 70  | Liquidar título da loja B numa conta exclusiva da loja A                              | `accountServesUnit()`                                             | erro de validação em português             |
| 71  | Conta a receber com fornecedor como contraparte                                       | CHECK `ck_fin_title_counterparty_direction`                       | recusa do InnoDB                           |
| 72  | Abrir título de outra empresa com o UUID em mãos                                      | fora do tenant                                                    | "não encontrado" (nunca 403)               |
| 73  | Liquidar com papel concedido só na outra unidade                                      | escopo da **unidade do título**                                   | erro de autorização                        |
| 74  | Financeiro tentar mudar `service_orders.status`                                       | fronteira de mão única                                            | **não existe código** que faça isso        |
| 75  | Emitir garantia interna com a OS ainda em `awaiting_customer_pickup`                  | a cobertura começa na entrega (ADR-063)                           | erro de regra de negócio                   |
| 76  | Forçar `status` ou `classification` pelo formulário de abertura de OS                 | o comando aceita ORIGEM, não estado (ADR-066)                     | a OS nasce em `awaiting_technical_opinion` |
| 77  | Reabrir a OS original num retorno em garantia                                         | retorno cria ordem NOVA (ADR-065)                                 | **não existe código** que faça isso        |
| 78  | Reaproveitar o número da OS original na OS de garantia                                | `allocateSequenceNumber` atômico                                  | número novo, sempre                        |
| 79  | Dois retornos apontando para a MESMA OS de garantia                                   | `UNIQUE (return_service_order_id)`                                | recusa do InnoDB                           |
| 80  | Retorno duplicado por retry com a mesma chave                                         | `UNIQUE (tenant_id, idempotency_key)`                             | devolve o mesmo retorno, sem duplicar      |
| 81  | Reclassificar sem justificativa (ou com menos de 15 caracteres)                       | validação de domínio                                              | erro de validação em português             |
| 82  | Reclassificar pelo seletor genérico de status                                         | regra `actionOnly` + `via` obrigatório                            | a transição não é oferecida                |
| 83  | Reclassificar sem `warranties.reclassify`, tendo só `service_orders.transition`       | permissão própria do ato                                          | erro de autorização                        |
| 84  | Ver custo de garantia tendo apenas `warranties.view`                                  | `warranties.costs.view` separada                                  | erro de autorização                        |
| 85  | Abrir garantia de outra empresa com o UUID em mãos                                    | fora do tenant                                                    | "não encontrado" (nunca 403)               |
| 86  | Abrir certificado pelo token sem sessão válida                                        | o token identifica, **não autoriza** (ADR-070)                    | redireciona para `/login`                  |
| 87  | Abrir certificado com token de outra empresa                                          | fora do tenant                                                    | "não encontrado"                           |
| 88  | Garantia criar cobrança em retorno coberto                                            | garantia válida é gratuita (ADR-071)                              | **não existe código** que faça isso        |
| 89  | Garantia escrever em `stock_balances`, `stock_movements` ou `financial_movements`     | fronteira de mão única                                            | **build vermelho** no teste de boundary    |
| 90  | Alterar a política e esperar que o certificado histórico mude                         | a garantia é snapshot (ADR-062)                                   | o documento antigo permanece idêntico      |

**Por que o item 3 responde 404 e não 403:** responder "sem permissão"
confirmaria que aquele registro existe. Para quem está do lado de fora, um ID
de outra empresa e um ID inexistente são indistinguíveis.

---

## 6. Onde cada linha é verificada

| Bloco                                                  | Teste                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Permitidos 1–5, negados 6, 11, 12, 13                  | `tests/integration/role-scope.test.ts`                                                                                              |
| Negados 3, 4, 5, 10, 22                                | `tests/integration/privilege-escalation.test.ts`                                                                                    |
| Negados 7, 8, 9                                        | `tests/integration/last-admin.test.ts`                                                                                              |
| Permitidos 6, 7, 8; negados 14–19                      | `tests/integration/account-security.test.ts`                                                                                        |
| Permitidos 1, 2, 3; perfis de origem                   | `tests/integration/user-administration.test.ts`                                                                                     |
| Negados 14, 15, 20                                     | `tests/integration/auth.test.ts`                                                                                                    |
| Negados 1, 2, 21                                       | `tests/integration/effective-access.test.ts` + navegador                                                                            |
| Negado 20 (janela e contagem)                          | `tests/unit/rate-limit.test.ts`                                                                                                     |
| Negado 22                                              | `tests/integration/cross-tenant-constraints.test.ts`                                                                                |
| Permitidos 10–12; negados 23–25                        | `tests/integration/equipment.test.ts` + `equipment-authorization.test.ts`                                                           |
| Negados 27, 28                                         | `tests/integration/equipment.test.ts` (bloco fotos)                                                                                 |
| Negado 26; permitido 12                                | navegador real contra o build de produção                                                                                           |
| Negado 29                                              | `tests/integration/equipment.test.ts` (FK composta)                                                                                 |
| Permitidos 13–15; negados 30–32, 34, 35                | `tests/integration/service-orders.test.ts` + `service-order-authorization.test.ts`                                                  |
| Negado 33                                              | `tests/integration/service-order-sequence.test.ts`                                                                                  |
| Permitidos 24–29; negados 63–74                        | `tests/integration/finance.test.ts`, `finance-concurrency.test.ts`, `finance-authorization.test.ts`, `finance-integrations.test.ts` |
| Negado 67                                              | `tests/unit/finance-boundary.test.ts` (varredura do código-fonte)                                                                   |
| Permitidos 30–35; negados 75, 77–81, 83–85, 87, 88, 90 | `tests/integration/warranties.test.ts`, `warranty-concurrency.test.ts`, `warranty-authorization.test.ts`                            |
| Negado 89                                              | `tests/unit/warranty-boundary.test.ts` (varredura do código-fonte)                                                                  |
| Negados 76 e 82                                        | `tests/integration/warranties.test.ts` (campos extras) + `tests/unit/service-order-workflow.test.ts` (seletor genérico)             |
| Negado 86                                              | navegador real contra o build de produção — o token sem sessão cai em `/login`                                                      |
| Interface: 75, 84 e as não-promessas                   | `tests/component/warranty-forms.test.tsx`                                                                                           |
