# Cadastro de fornecedores

## O fornecedor é da EMPRESA

`suppliers` tem `tenant_id` e **não tem `unit_id`**. A empresa negocia com o
distribuidor; a loja não. Duplicar o cadastro por unidade criaria três
fornecedores que nenhum relatório soma e que a busca mostra em triplicata.

Consequência prática: `suppliers.manage` é capacidade de tenant. Quem só opera
numa loja não passa a mandar no cadastro comercial da empresa por estar logado
nela.

## Fornecedor não é fabricante

`parts.brand` continua sendo o fabricante da peça. "Samsung" é marca; a
distribuidora de onde a tela veio é outra coisa, e são as duas que a assistência
precisa saber. Nada neste módulo transforma uma na outra.

## Documento opcional, validado quando informado

`SUPPLIER_DOCUMENT_REQUIRED = false`.

O balcão compra parafuso da loja da esquina. Exigir CNPJ faria alguém digitar
`00.000.000/0000-00` para conseguir salvar — um dado falso é pior que um dado
ausente, porque o relatório acredita nele.

Quando informado:

- é **validado pelos dígitos**, não pela máscara: `111.111.111-11` tem a forma
  certa e é recusado;
- é **único na empresa**: UNIQUE `(tenant_id, document_digits)`;
- o mesmo CNPJ em **outra** empresa é legítimo — e há teste para isso.

A validação vive em `src/core/document/brazilian-document.ts`. Ela nasceu em
Clientes (Prompt 05) e subiu para o core quando Compras precisou da mesma
verificação. Fornecedor **não é** cliente — são cadastros, tabelas e permissões
diferentes —, mas CPF e CNPJ são os mesmos em qualquer contexto.

## Contatos

`supplier_contacts` guarda as pessoas com quem se fala: o vendedor e, quando
existe, o financeiro. São dados de **pessoa física** dentro de um cadastro de
empresa, e por isso entram na política de dado pessoal (ver
[security.md](security.md)).

A edição **substitui a lista inteira**, como o editor de orçamento faz e pela
mesma razão: a lista é curta e vive dentro de um formulário que a pessoa vê
por completo. Reconciliar por id produziria um diff frágil sem ganho nenhum.

## Prazo prometido × prazo real

`suppliers.lead_time_days` é **o que o fornecedor promete**. O prazo real é
medido a cada recebimento e gravado em
`purchase_price_history.observed_lead_time_days` — a diferença entre
`placed_at` e a chegada, em dias.

É nulo quando o pedido não tem data de realização: inventar zero afirmaria
entrega imediata, que é justamente o que não se sabe.

## Inativar não apaga nada

`changeSupplierStatus(..., 'inactive')` faz uma coisa só: o fornecedor **deixa
de ser oferecido em pedido novo**.

Pedidos antigos, recebimentos, histórico de preço e o vínculo fornecedor×peça
continuam onde estavam e continuam legíveis. O teste de integração abre um
pedido, inativa o fornecedor e verifica que o recebimento daquele pedido ainda
funciona — porque a mercadoria está a caminho independentemente da decisão
comercial.

## Busca

`listSuppliers` procura por razão social, nome fantasia, documento, telefone e
e-mail, cada campo na sua forma normalizada: nome sem acento, documento e
telefone só com dígitos. Jogar tudo num `LIKE` sobre o texto cru faria
`11 98888-7777` não encontrar quem foi cadastrado como `(11) 98888-7777`.
