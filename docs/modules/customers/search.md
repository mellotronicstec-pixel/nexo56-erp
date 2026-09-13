# Busca, filtros e índices — Clientes

O critério de sucesso é o balcão: quem atende digita **o que tem na mão** — o
número que o cliente falou, o CPF do documento, ou só o primeiro nome — e
precisa achar.

## O que a busca encontra

| Digitando         | Encontra por                                 |
| ----------------- | -------------------------------------------- |
| `silva`           | nome ou razão social (trecho)                |
| `jose` / `José`   | nome, **ignorando acento nos dois sentidos** |
| `padaria`         | nome fantasia                                |
| `12345678900`     | CPF/CNPJ (prefixo)                           |
| `123.456.789-00`  | o **mesmo** cliente — a pontuação é removida |
| `11988887777`     | telefone                                     |
| `(11) 98888-7777` | o mesmo telefone                             |
| `988887777`       | telefone sem o DDD                           |
| `maria@`          | e-mail (trecho)                              |

Os dois lados da comparação passam pela **mesma normalização**, que é o motivo
de formatado e não-formatado caírem no mesmo lugar.

## Como está implementado

Dois caminhos, porque são dois tipos de dado:

1. **texto** → compara com `name_normalized` e `trade_name_normalized`;
2. **dígitos** → compara com `document_digits` (prefixo) e com o contato
   normalizado (trecho, porque é comum lembrar do número sem o DDD).

Os contatos entram por **`EXISTS`**, não por `JOIN`: um cliente com cinco
telefones apareceria cinco vezes num JOIN, e o `total` da paginação sairia
errado. Há teste para isso.

## Tudo no servidor

Busca, filtros, ordenação e paginação acontecem no banco. Nenhuma consulta traz
a lista completa para o navegador filtrar — com dezenas de milhares de clientes
isso trava, e é o tipo de decisão que só aparece quando já é tarde para mudar.

A listagem faz **duas** consultas, independentemente do tamanho da página: uma
para os clientes e uma para os contatos principais daquela página. Não é N+1.

## Ordenação

Padrão: **atualizados recentemente** (`updated_at DESC, id DESC`).
Alternativa: **nome** (`name_normalized ASC, id ASC`).

O desempate por `id` não é opcional: com UUIDv7 duas linhas do mesmo
milissegundo teriam ordem indefinida, e um cliente poderia aparecer duas vezes
ou sumir entre a página 1 e a 2.

## Índices criados, e por quê

| Índice                              | Motivo                              |
| ----------------------------------- | ----------------------------------- |
| `uq_customers_tenant_document`      | Unicidade **e** busca por documento |
| `ix_customers_tenant_name`          | Busca por nome dentro do tenant     |
| `ix_customers_tenant_trade_name`    | Busca por nome fantasia             |
| `ix_customers_tenant_status`        | Filtro de situação                  |
| `ix_customers_tenant_kind`          | Filtro PF/PJ                        |
| `ix_customers_tenant_updated`       | Ordenação padrão da listagem        |
| `ix_customer_contacts_tenant_value` | Busca por telefone e e-mail         |
| `ix_customer_contacts_customer`     | Carregar os contatos de um cliente  |
| `ix_customer_addresses_customer`    | Carregar o endereço de um cliente   |

Nenhum índice foi criado "por precaução": cada um atende a uma consulta que o
módulo realmente executa.

### Limite conhecido e honesto

A busca por nome usa `LIKE '%termo%'` — **curinga à esquerda não faz busca por
prefixo no índice**. O índice composto ainda ajuda de verdade, porque a
igualdade em `tenant_id` restringe a varredura às entradas daquele tenant, num
índice estreito, em vez de varrer a tabela toda.

Para tenants com centenas de milhares de clientes, a evolução natural é um
índice `FULLTEXT` sobre as colunas normalizadas. Não foi feito agora porque
`FULLTEXT` traz regras próprias (tamanho mínimo de palavra, modo booleano,
stopwords) que mudam o comportamento da busca — e essa mudança merece sua
própria decisão, com dados reais de uso.

## Estado na URL

```
/clientes?q=joao&tipo=individual&situacao=active&ordem=name&pagina=2
```

O botão voltar funciona, recarregar não perde a tela e o atendente pode mandar
o link pronto para o colega. Uma busca nova sempre volta para a primeira
página — `pagina` não é reenviado pelo formulário de filtros.
