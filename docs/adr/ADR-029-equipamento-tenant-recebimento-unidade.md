# ADR-029 — Equipamento pertence ao tenant; recebimento pertence à unidade

**Status:** Aceito · **Data:** Prompt 06

## Contexto

O Nexo56 é multiunidade desde o Prompt 03, e o Prompt 05 já decidiu que o
**cliente pertence ao tenant** (ADR-026).

Ao modelar Equipamentos, a mesma pergunta reaparece — _de quem é o aparelho?_ —
mas agora com uma segunda entidade junto: o **recebimento**, que é o ato de o
aparelho entrar na assistência.

Tratar as duas como uma coisa só é o caminho mais curto: uma tabela
`equipment` com `unit_id`, `received_at` e o checklist dentro. Funciona no
primeiro atendimento e quebra no segundo.

## Decisão

São duas entidades, com donos diferentes:

- **`equipment` pertence ao TENANT.** Sem unidade proprietária.
  `origin_unit_id` existe apenas como procedência auditável e nunca entra em
  cláusula de filtro.
- **`equipment_intakes` pertence à UNIDADE.** `unit_id` obrigatório, vindo de
  `context.activeUnitId`, jamais do formulário.

Acessórios, condições físicas e fotos de atendimento penduram no recebimento,
não no equipamento.

## Motivo

O caso real decide. Um cliente deixa o mesmo televisor na loja Centro em março e
na loja Norte em novembro.

Com equipamento por unidade, o atendente da loja Norte busca, não acha, cadastra
de novo — e a empresa passa a ter dois registros do mesmo aparelho, com
históricos partidos. Pior: a duplicata é **invisível** para quem a cria; ele fez
exatamente o que o sistema mandava. É o mesmo erro que o ADR-026 recusou para
clientes, e pelo mesmo motivo.

Com tudo no tenant e sem recebimento separado, o inverso: a fila de bancada da
loja Centro apareceria para quem opera a loja Norte, e o segundo atendimento
sobrescreveria o estado físico registrado no primeiro — apagando a prova de como
o aparelho chegou da primeira vez.

O aparelho é um **objeto que atravessa** unidades e anos. O recebimento é um
**acontecimento** com lugar e hora. São coisas de natureza diferente, e a
diferença é exatamente o eixo do isolamento por unidade.

## Consequências

- A ficha do equipamento mostra a linha do tempo dos recebimentos, cada um com a
  unidade onde ocorreu. Trocar de unidade ativa depois não reescreve nada.
- A Ordem de Serviço (Prompt 07) nasce de um recebimento e herda dele a unidade,
  sem inventar uma nova.
- Consultas de recebimento sempre filtram por `tenant_id` **e** `unit_id`;
  consultas de equipamento filtram só por `tenant_id`. Confundir as duas é o
  erro que os testes de regressão vigiam.
- A separação custa uma tabela a mais e um JOIN nas listagens de fila. É barato
  perto de reconstruir histórico partido depois.

## Alternativas descartadas

**Equipamento com `unit_id`.** Recadastro a cada loja, histórico partido,
duplicata invisível.

**Recebimento como colunas dentro de `equipment`.** Só o último atendimento
sobrevive; o estado de entrada anterior é perdido justamente quando alguém
reclama do que foi feito antes.

**Equipamento e recebimento ambos no tenant.** A fila de uma loja vazaria para
as outras, contrariando o isolamento por unidade que o Prompt 03 estabeleceu.
