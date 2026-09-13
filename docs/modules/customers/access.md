# Permissões, privacidade e auditoria — Clientes

## Permissões

Seguem a convenção do catálogo (`<recurso>.<ação>`, com `view`/`manage` e uma
permissão separada quando o risco é diferente):

| Permissão                 | Concede                                      |
| ------------------------- | -------------------------------------------- |
| `customers.view`          | Consultar a lista e a ficha                  |
| `customers.manage`        | Criar e editar cadastro, contatos e endereço |
| `customers.change_status` | Ativar e inativar                            |

As quatro capacidades que o prompt pede se mapeiam assim: **visualizar** →
`view`; **criar** e **editar** → `manage`; **alterar status** →
`change_status`.

Alterar situação ficou separada de propósito: ela muda o que aparece na
operação do dia a dia, enquanto editar um telefone não muda.

### Não são permissões de alto risco

`customers.*` **não** entra em `HIGH_RISK_PERMISSIONS`. Alto risco ali significa
"amplia acesso, direta ou indiretamente" — e administrar clientes não concede
capacidade a ninguém. São permissões de **dado pessoal**, que é uma preocupação
real e diferente, tratada pelo RBAC e pela auditoria.

## Feature

`core.customers`, tipo **CORE**. Não por importância, mas por consequência:
Ordens de Serviço, Garantias e Financeiro vão depender de Cliente. Deixar o
tenant desligar Clientes seria oferecer um botão que quebra os módulos que
vierem depois.

O menu mostra Clientes apenas quando a feature está disponível **e** a pessoa
tem `customers.view` — o mesmo Effective Access dos módulos anteriores, sem
mecanismo novo.

## Isolamento

Toda consulta e toda mutação são resolvidas por `tenant_id + id`. Um ID válido
de outra empresa **não encontra nada**, e a resposta é "não encontrado" — nunca
"sem permissão", que confirmaria a existência do registro.

Coberto por testes obrigatórios em `customer-authorization.test.ts`: ler,
editar e mudar status de cliente de outro tenant, com o ID em mãos.

## Dados pessoais

O cadastro contém dados pessoais, e o código reflete isso — não só a
documentação:

| Prática                          | Onde                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| Formulário nunca vai para o log  | `actions.ts` loga só operação e mensagem                       |
| CPF/CNPJ nunca em log            | idem                                                           |
| Auditoria **não copia** o objeto | grava `hasDocument`, `documentType`, contagem — nunca o número |
| Contato nunca em auditoria       | verificado por teste                                           |
| Observações internas como texto  | React escapa; nenhum caminho interpreta HTML                   |
| Erro técnico não expõe dado      | mensagens de negócio, sem stack trace                          |

O teste `NAO copia CPF, telefone nem e-mail para a auditoria` serializa os
registros gravados e falha se o CPF, o e-mail ou o telefone aparecerem.

### Sobre mascarar o documento

O CPF/CNPJ aparece **inteiro** na ficha e na listagem. Quem atende precisa
conferir o documento com a pessoa na frente, e mascarar por estética
atrapalharia o atendimento sem proteger nada: quem vê a tela já tem permissão
para ver o cadastro. A proteção real está no RBAC e na trilha de auditoria.

## Auditoria

| Ação                        | Quando                                  |
| --------------------------- | --------------------------------------- |
| `customer.created`          | Cadastro criado                         |
| `customer.updated`          | Cadastro alterado                       |
| `customer.document_changed` | CPF/CNPJ incluído, alterado ou removido |
| `customer.activated`        | Reativação                              |
| `customer.deactivated`      | Inativação                              |

A mudança de documento tem trilha própria por ser o identificador forte do
cliente — quem trocou e quando é pergunta que aparece.

Eventos de domínio correspondentes: `CUSTOMER_CREATED`, `CUSTOMER_UPDATED`,
`CUSTOMER_STATUS_CHANGED`, emitidos **após** o commit.

A ficha do cliente mostra a trilha real daquele cadastro, escopada por tenant.
