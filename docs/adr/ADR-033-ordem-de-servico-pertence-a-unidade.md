# ADR-033 — A Ordem de Serviço pertence ao tenant e à unidade

**Status:** Aceito · **Data:** Prompt 07

## Contexto

O Nexo56 já resolveu duas vezes a pergunta "de quem é esta entidade":

- **Cliente pertence ao tenant** (ADR-026) — a mesma pessoa é atendida em
  qualquer filial.
- **Equipamento pertence ao tenant; recebimento pertence à unidade**
  (ADR-029) — o aparelho atravessa as lojas, a entrega aconteceu numa delas.

A Ordem de Serviço chega com a pergunta de novo, e desta vez com uma tentação
específica: como ela referencia cliente e equipamento, ambos do tenant, seria
"coerente" mantê-la também no tenant.

## Decisão

**`service_orders` tem `tenant_id` e `unit_id`, ambos obrigatórios.**

`unit_id` vem de `context.activeUnitId`, nunca do formulário, e não muda depois
da abertura.

Quando a OS nasce de um recebimento, a unidade dos dois tem de ser a mesma —
garantido pela FK composta `(intake_id, unit_id)` contra
`equipment_intakes (id, unit_id)`.

## Motivo

A OS não é um dado sobre o aparelho: é **o trabalho assumido**. Ela tem bancada,
prazo, técnico e fila — e nada disso é compartilhado entre filiais.

Se a OS fosse do tenant, a fila de trabalho de cada loja apareceria para todas as
outras. Numa empresa com três lojas, o técnico da Norte abriria o sistema e veria
sessenta ordens, das quais vinte são dele. A separação por unidade não é
segurança contra o colega — é a diferença entre uma lista utilizável e uma lista
que ninguém olha.

No sentido inverso, amarrar cliente e equipamento à unidade só porque a OS está
lá recriaria o recadastro que os ADR-026 e ADR-029 recusaram.

**Por que a unidade não vem do formulário:** aceitar `unitId` do navegador
permitiria a quem opera a loja Centro carimbar serviço na Norte — e a OS é
justamente o registro de quem assumiu o trabalho. Um campo que o cliente controla
não pode responder "quem é o responsável".

**Por que a unidade não muda depois:** a OS acumulará orçamento, peças,
pagamentos e garantia, todos com consequência operacional na unidade. Mudar a
unidade como edição comum moveria esse histórico inteiro de lugar sem registro.
Transferência entre unidades, se um dia for necessária, será caso de uso próprio
e auditado.

## Consequências

- A listagem é da unidade ativa. Trocar de unidade muda o que aparece — e é o
  comportamento correto.
- Autorização usa `requireUnitAuthorization`: a permissão é avaliada **dentro da
  unidade**, o que faz valer tanto papel de tenant quanto papel concedido só
  naquela loja.
- Ordem de outra unidade responde "não encontrada", igual a inexistente.
- A numeração, ao contrário do ownership, é **do tenant** (ADR-034). Ownership e
  numeração respondem a perguntas diferentes.
- A Central de Trabalho (Prompt 15) poderá oferecer uma visão multiunidade para
  quem tiver acesso a várias — sem que isso mude o dono do registro.

## Alternativas descartadas

**OS no tenant, com `unit_id` informativo.** A fila de cada loja vazaria para as
outras, e o isolamento por unidade do Prompt 03 viraria decoração.

**OS na unidade, com cliente e equipamento copiados.** Duplicaria cadastro e
recriaria o problema que o ADR-026 resolveu.

**Unidade vinda do formulário, validada contra as autorizadas.** Funcionaria,
mas transformaria uma decisão de contexto numa entrada do usuário — e toda
entrada do usuário é superfície de ataque e de erro.
