# ADR-036 — A entidade e o workflow são decididos em prompts separados

**Status:** Aceito · **Data:** Prompt 07

## Contexto

A Ordem de Serviço tem duas naturezas: **o que ela é** (número, vínculos, relato,
histórico) e **como ela muda de estado** (aguardando parecer, aguardando
aprovação, aguardando peça, concluída…).

A segunda é a parte mais sensível do Nexo56: estados, transições condicionais,
ações, regras, follow-ups, tarefas automáticas e preparação para entrega.

A entidade precisa de uma coluna de estado para funcionar. Isso cria uma porta
por onde o workflow inteiro pode entrar sem ninguém decidir que entrou: primeiro
a coluna, depois a lista completa de estados "só para documentar", depois um `if`
numa tela, e a máquina de estados passa a existir espalhada e não projetada.

## Decisão

O Prompt 07 implementa **um único estado** — o inicial,
`awaiting_technical_opinion` — e **nenhuma transição**.

Três garantias estruturais:

1. **`status` é `varchar(40)`, não `ENUM`.** O Prompt 08 acrescenta estados sem
   `ALTER TABLE … MODIFY COLUMN`.
2. **`SERVICE_ORDER_STATUS_LABEL` tem uma entrada só**, e há teste que falha se
   ganhar outra.
3. **Nenhum estado é uma ação.** Há teste verificando que `buscar_peca`,
   `enviar_orcamento` e `informar_disponivel` não existem como estado.

## Motivo

Declarar agora a lista completa de estados pareceria inofensivo — é "só
documentação". Mas uma lista de estados no domínio é um convite: a primeira tela
que precisar de um rótulo vai lê-la, a segunda vai comparar com ela, e quando o
Prompt 08 chegar encontrará regras de workflow já escritas em lugares que ele não
controla. Reunir isso depois custa mais do que escrever certo da primeira vez.

`ENUM` tem o mesmo efeito no banco: ele força a decisão sobre a lista inteira
agora, e cobra um `ALTER` a cada revisão. `varchar` com validação no domínio
deixa a autoridade onde ela deve estar.

A separação também protege o Prompt 08: ele recebe uma entidade estável, com
numeração, vínculos, autoria, auditoria, eventos e histórico já testados, e pode
concentrar-se no que é difícil.

## Consequências

- Hoje a ficha mostra "Aguardando parecer tecnico" e nada mais sobre estado. Não
  há botão de transição, e a ausência é deliberada — não é uma tela inacabada.
- `ix_service_order_tenant_status` já existe, para os filtros que o Prompt 08
  trará.
- `service_order_timeline` aceita `kind` novo sem migration: `status_changed`
  entra como linha, não como coluna.
- O Prompt 08 não precisará de migration destrutiva nem de reescrita do domínio
  da OS — que é o critério do item 157.

## Alternativas descartadas

**`ENUM` com a lista completa de estados.** Antecipa a decisão do Prompt 08 e
cobra `ALTER TABLE` a cada ajuste.

**Nenhuma coluna de estado.** A entidade não funcionaria, e o Prompt 08 teria de
alterar toda linha existente para preencher o estado inicial retroativamente.

**Coluna com um `ENUM` de um valor só.** Igual em espírito à decisão tomada, mas
com um `ALTER` garantido no Prompt 08 e nenhum ganho em troca.
