# ADR-026 — Cliente pertence ao tenant, não à unidade

**Status:** Aceito · **Data:** Prompt 05

## Contexto

O Nexo56 é multiunidade desde o Prompt 03: uma empresa pode ter várias lojas, e
o usuário opera com uma unidade ativa por vez. Papéis podem valer só numa
unidade, e o seletor de unidade troca o contexto.

Ao modelar Clientes, a pergunta é: **de quem é o cliente?**

O caminho aparentemente coerente seria `unit_id` obrigatório em `customers` —
afinal, quase tudo no ERP acontece numa unidade, e o isolamento por unidade já
existe no vocabulário do sistema.

## Decisão

**O cliente pertence ao TENANT.** `customers` tem `tenant_id` obrigatório e
**não** tem unidade proprietária.

`origin_unit_id` existe como **procedência**: registra onde o cadastro nasceu,
para relatório e auditoria. Ele nunca entra em cláusula de filtro.

A unidade pertencerá à **Ordem de Serviço**, que é o que de fato acontece num
lugar específico.

## Motivo

O caso real decide: uma assistência com três lojas atende o João na loja A e,
seis meses depois, na loja B. Com cliente por unidade, o atendente da loja B não
acha o cadastro, cria outro, e a empresa passa a ter dois "João da Silva" — com
históricos partidos, garantias em lugares diferentes e dois telefones que
ninguém sabe qual é o certo.

Pior: a duplicata é **invisível** para quem a cria. Ele buscou, não achou, e
cadastrou de novo fazendo exatamente o que o sistema mandava.

Cliente é uma relação da **empresa** com a pessoa. A unidade é onde o
atendimento acontece — informação da operação, não da identidade.

Há um custo aceito: quem só deveria ver os clientes de uma loja vê todos do
tenant. Isso é um requisito de **autorização**, não de modelagem, e o RBAC já
sabe expressá-lo quando existir demanda real — enquanto o contrário
(desmembrar cadastros duplicados depois) não tem volta.

## Alternativas descartadas

| Alternativa                                    | Por que não                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `unit_id` obrigatório em `customers`           | Cadastros duplicados por filial; histórico partido; a duplicata nasce invisível             |
| Cliente do tenant + tabela `customer_units`    | Complexidade de sincronização sem caso de uso; nada hoje pede "este cliente só existe aqui" |
| Filtrar a listagem por `origin_unit_id`        | Recria o isolamento por unidade disfarçado de procedência                                   |
| Duplicar o cliente ao atender em outra unidade | O problema que a decisão existe para evitar                                                 |

## Consequências

- Trocar de unidade **não** muda a lista de clientes. Há teste de regressão para
  isso, porque é justamente o comportamento que um refactor futuro quebraria sem
  perceber.
- O documento é único **por tenant**, não por unidade — coerente com "um cadastro
  por pessoa na empresa".
- Quando um módulo precisar de visibilidade por unidade, a resposta será uma
  regra de autorização (uma permissão, um escopo), não uma coluna nova em
  `customers`.
- A Ordem de Serviço, quando chegar, carrega `unit_id` obrigatório. O modelo já
  está preparado para isso.
