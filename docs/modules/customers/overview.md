# Clientes

Cadastro das pessoas e empresas atendidas. É a base de relacionamento sobre a
qual Ordens de Serviço, Equipamentos, Garantias e Financeiro serão construídos.

Decisões: [ADR-026](../../adr/ADR-026-cliente-pertence-ao-tenant.md),
[ADR-027](../../adr/ADR-027-contatos-de-cliente.md),
[ADR-028](../../adr/ADR-028-duplicidade-de-cliente.md).

## Índice

- [Modelo de dados](model.md)
- [Busca e índices](search.md)
- [Permissões e auditoria](access.md)

## A decisão que define o módulo

**O cliente pertence ao TENANT, não à unidade.**

Uma assistência com três lojas cadastra o João na loja A e o atende na loja B
sem recadastrar. A unidade pertencerá à **Ordem de Serviço** — que é o que de
fato acontece num lugar específico.

```
Tenant ──< Cliente
                │
                └──< Ordem de Serviço >── Unidade   (módulo futuro)
```

`customers.origin_unit_id` guarda onde o cadastro nasceu. É **procedência
auditável**, nunca filtro: usar a unidade de origem para restringir acesso
recriaria por acidente o isolamento por unidade que este modelo recusa.
Coberto por teste de regressão (`customers.test.ts`, bloco MULTIUNIDADE).

## O que o módulo faz

| Capacidade                                                    | Estado                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| Cadastro rápido (nome + um contato)                           | implementado                                                 |
| Pessoa física e jurídica, com campos próprios                 | implementado                                                 |
| CPF/CNPJ opcionais, validados quando informados               | implementado                                                 |
| Documento único por tenant, garantido pelo banco              | implementado                                                 |
| Vários contatos, com principal e marcação de WhatsApp         | implementado                                                 |
| Endereço                                                      | implementado (um por cliente na interface; tabela suporta N) |
| Observações internas                                          | implementado                                                 |
| Busca por nome, fantasia, documento, telefone e e-mail        | implementado                                                 |
| Filtros por tipo e situação, ordenação, paginação no servidor | implementado                                                 |
| Ativar / inativar                                             | implementado                                                 |
| Histórico de auditoria na ficha                               | implementado                                                 |
| Aviso de contato semelhante                                   | implementado no domínio (`findSimilarByContact`)             |
| Preenchimento automático por CEP                              | **não implementado** — sem integração definida               |
| Exclusão física                                               | **não existe**, por decisão                                  |
| Mesclagem de duplicados                                       | **não implementado**                                         |

## Cadastro rápido

O mínimo é **nome** (ou razão social) e **uma forma de contato** — telefone,
WhatsApp ou e-mail. Nada além disso é exigido.

CPF e CNPJ **não** são obrigatórios: muita gente não informa o documento no
primeiro contato, e recusar o cadastro por isso impediria o atendimento. Quando
informados, são validados pelos dígitos verificadores e ficam únicos no tenant.

Cliente **sem nenhum contato** é recusado, com mensagem que explica: um cadastro
assim não permite nem avisar que o aparelho ficou pronto.

## Rotas

| Rota                    | Exige                                      |
| ----------------------- | ------------------------------------------ |
| `/clientes`             | `customers.view`                           |
| `/clientes/novo`        | `customers.manage`                         |
| `/clientes/[id]`        | `customers.view` + cliente do mesmo tenant |
| `/clientes/[id]/editar` | `customers.manage`                         |

Alterar situação exige `customers.change_status`, verificado na Server Action.

## Fora de escopo neste módulo

Ordens de Serviço, equipamentos, financeiro, cobrança, CRM, campanhas, disparo
de WhatsApp ou e-mail, importação em massa, portal LGPD e busca global. A ficha
do cliente **não** tem abas vazias prometendo esses módulos — uma aba que não
leva a lugar nenhum é pior do que a ausência dela.
