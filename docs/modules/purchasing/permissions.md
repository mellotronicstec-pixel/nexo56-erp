# Permissões

Oito chaves, todas com `featureKey: 'operations.purchasing'`.

| Chave               | O que concede                                                     |
| ------------------- | ----------------------------------------------------------------- |
| `suppliers.view`    | ver a lista e a ficha de fornecedores                             |
| `suppliers.manage`  | cadastrar, editar e inativar fornecedor                           |
| `purchases.view`    | ver necessidades, pedidos e histórico de preço                    |
| `purchases.create`  | registrar necessidade e abrir pedido                              |
| `purchases.update`  | editar o rascunho: itens, custos, observações                     |
| `purchases.approve` | aprovar a compra e registrar o pedido como realizado              |
| `purchases.receive` | registrar a chegada da mercadoria — **cria movimento de estoque** |
| `purchases.cancel`  | cancelar pedido, com motivo                                       |

## Por que são oito, e não uma

Porque são capacidades diferentes, exercidas por pessoas diferentes:

- **Quem monta o pedido não é quem autoriza a despesa.** Numa assistência
  pequena a mesma pessoa tem as duas permissões; numa maior, o corte é real —
  e ele precisa existir no modelo para poder existir na empresa.
- **Quem recebe a caixa no balcão** não é, necessariamente, nenhum dos dois.
- **Quem cuida do cadastro do distribuidor** pode não ter nada a ver com
  compras.

O perfil `compras` do catálogo agrupa as oito para o caso comum; separar
continua possível porque as chaves são separadas.

## Escopo

| Permissão     | Escopo  | Verificada em           |
| ------------- | ------- | ----------------------- |
| `suppliers.*` | TENANT  | `unitId: null`          |
| `purchases.*` | UNIDADE | a unidade **do pedido** |

`purchases.receive` é verificada **na unidade do pedido**, que nem sempre é a
unidade ativa da sessão (item 47). Quem recebe cria saldo naquela unidade — e
autorizar pela unidade ativa deixaria alguém dar entrada numa loja em que não
opera.

## Receber não exige permissão de estoque

`purchases.receive` **basta** para o recebimento criar a entrada. A primitiva
`applyStockEntry` não reautoriza: quem chamou já autorizou, na unidade certa.

Isso é deliberado e está documentado aqui porque é o tipo de decisão que
surpreende: quem recebe mercadoria de compra não precisa de `inventory.receive`.
Se precisasse, a empresa teria de dar ao balconista a capacidade genérica de dar
entrada em qualquer peça, por qualquer motivo — que é mais acesso, não menos.

O teste `purchasing-authorization.test.ts` cobre exatamente esse caso.

## O backend é a autoridade

Todos os testes de RBAC de Compras chamam os casos de uso **diretamente**, sem
passar por tela nenhuma — que é como um atacante chamaria. Esconder o botão é
clareza de interface, não segurança.

A tela **não mostra o que a pessoa não pode fazer**: botão desabilitado é mudo e
ensina a equipe a ignorar a interface. Quando não há transição possível, o
painel inteiro desaparece.
