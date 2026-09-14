# ADR-040 — O orçamento pertence à Ordem de Serviço, e a unidade vem dela

**Status:** Aceito · **Data:** Prompt 09

## Contexto

O orçamento precisa de dono. As opções naturais eram:

1. **do tenant**, com um vínculo opcional a uma OS — permitiria orçar antes de
   abrir a ordem;
2. **da unidade**, com `unit_id` próprio vindo do contexto da sessão;
3. **da Ordem de Serviço**, herdando dela tenant e unidade.

A primeira é sedutora porque existe um caso real: o cliente liga perguntando
"quanto custa trocar a tela?". Mas isso é uma **cotação**, não um orçamento — não
tem aparelho identificado, não tem diagnóstico, e não vira trabalho.

A segunda cria um problema silencioso: se `unit_id` vem da sessão e a OS é de
outra unidade, nasce um orçamento coerente do ponto de vista do banco e incoerente
do ponto de vista da operação — a proposta de uma loja pendurada no trabalho de
outra.

## Decisão

**O orçamento pertence à Ordem de Serviço.** `service_order_id` é obrigatório;
não existe orçamento avulso.

A unidade é **derivada da OS**, e a coerência é imposta pelo **banco**:

```sql
unit_id            NOT NULL
FOREIGN KEY (service_order_id, unit_id)
  REFERENCES service_orders(id, unit_id)
```

A coluna `unit_id` é redundante em relação à OS **de propósito**: sem ela, a FK
composta não existiria, e a coerência dependeria da aplicação.

Cliente e equipamento **não** se repetem no orçamento: são lidos da OS.

## Motivo

**Por que não do tenant.** Um orçamento sem OS não teria aparelho, não teria
unidade, não teria como virar trabalho, e a pergunta "de quem é essa proposta?"
não teria resposta estrutural. Cotação avulsa, se um dia existir, é outra
entidade com outro nome.

**Por que a unidade vem da OS.** A OS é o trabalho assumido por uma loja
específica (ADR-033). A proposta comercial daquele trabalho é da mesma loja, por
definição — não é uma segunda decisão que alguém possa tomar diferente.

**Por que a FK composta, e não só validação no serviço.** É a mesma lição do
Prompt 07 com `uq_intake_id_unit`: checagem de aplicação some no dia em que
alguém escreve um segundo caminho de criação. Para isto, a 0007 acrescenta de
forma aditiva `uq_service_order_id_unit` em `service_orders`.

**Por que não copiar cliente e equipamento.** Duas verdades sobre o mesmo
atendimento — e a segunda fica desatualizada no primeiro ajuste.

## Consequências

- Criar orçamento exige uma OS existente e acessível; OS de outra empresa ou de
  unidade sem vínculo responde "não encontrada".
- A numeração é do **tenant**, compartilhada entre unidades — mesma decisão da
  OS (ADR-034), pelo mesmo motivo: dois "ORC 45" na mesma empresa tornariam o
  número inútil ao telefone.
- Apagar uma OS com orçamento é recusado pelo banco (`ON DELETE RESTRICT`).
- O Prompt 10 encontra a linha de peça já amarrada a uma unidade real, que é
  onde o estoque físico vai existir.

## Alternativas descartadas

**Orçamento do tenant com OS opcional.** Criaria uma entidade que às vezes tem
unidade e às vezes não, e toda consulta teria de lidar com os dois casos.

**`unit_id` só na OS, sem repetir.** Economiza uma coluna e perde a garantia de
banco — o pior negócio possível num sistema multiempresa.

**Copiar cliente e equipamento para o orçamento.** Facilitaria uma consulta e
criaria uma divergência permanente.
