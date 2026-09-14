# ADR-041 — Revisão é linha nova com o mesmo número, e a anterior não é tocada

**Status:** Aceito · **Data:** Prompt 09

## Contexto

O cliente achou caro. A loja refaz a conta. Isso acontece o tempo todo, e o
sistema precisa responder, meses depois, a três perguntas:

- quanto foi proposto da primeira vez?
- o que o cliente decidiu sobre **aquela** proposta?
- qual é a proposta que vale agora?

Se os valores forem alterados no lugar, a primeira pergunta perde resposta — e
com ela a segunda, porque "recusado" sem saber o quê não significa nada.

Havia três estratégias:

- **A) versionar o mesmo registro** — guardar versões numa tabela à parte;
- **B) novo orçamento, número novo** — cada proposta é um documento independente;
- **C) novo registro, mesmo número, revisão incrementada**.

## Decisão

**C.** A revisão é uma **linha nova** em `quotes`, com o **mesmo `number`** e
`revision` seguinte, apontando para a anterior por `supersedes_quote_id`.

```
ORC #000045          revision 1   → recusado    (intacto)
ORC #000045 rev. 2   revision 2   → rascunho
```

`UNIQUE (tenant_id, number, revision)`.

A versão anterior **sai de cena apenas se ainda estava viva**:

| Situação anterior | Vira         |
| ----------------- | ------------ |
| `sent`            | `superseded` |
| `rejected`        | `rejected`   |
| `approved`        | `approved`   |
| `expired`         | `expired`    |

Os itens são copiados para a nova. Valores só podem ser alterados enquanto o
orçamento é `draft`.

## Motivo

**Por que não A.** Uma tabela de versões guarda o histórico, mas obriga toda
consulta a decidir se está lendo a versão corrente ou uma antiga, e transforma
"quanto propusemos em março?" numa junção. Além disso, a versão antiga deixa de
ter situação própria — e "o cliente recusou a versão 1, não a 2" é exatamente o
que se precisa registrar.

**Por que não B.** O cliente tem um papel na mão escrito "orçamento 45". Mudar o
número quando a loja refaz a conta obriga o atendente a explicar, por telefone,
que o 51 é o 45 de antes. O número é o identificador humano do documento
(ADR-013): ele deve ser estável.

**Por que a recusa não vira "substituído".** A decisão do cliente é fato
histórico. Reescrevê-la para arrumar a narrativa da loja é justamente o tipo de
coisa que a auditoria existe para impedir.

**Por que os itens são copiados.** Revisar quase sempre é ajustar uma linha, não
recomeçar. Começar do zero faria a pessoa redigitar tudo — e redigitação é onde
o erro de um zero a mais acontece.

## Consequências

- O histórico completo de quanto já foi proposto fica no banco, sem tabela extra.
- `uq_quote_active (service_order_id, active_marker)` garante **uma proposta viva
  por OS**: a anterior precisa sair do ar antes de a revisão nascer, e as duas
  coisas acontecem na mesma transação.
- `uq_quote_approved (service_order_id, approved_marker)` garante **uma versão
  aprovada por OS** (item 66 do Prompt 09).
- Não se cria revisão de um rascunho: edita-se o próprio rascunho.
- O rótulo mostra a revisão a partir da segunda (`ORC #000045 rev. 2`), para o
  cliente saber que o papel na mão dele não é mais o vigente.
- **Fica em aberto:** o orçamento complementar depois da aprovação — o técnico
  abre o aparelho e encontra outro defeito. Não há caminho hoje, porque exigiria
  uma transição `Aguardando Conserto → Aguardando Aprovação` que a matriz do
  Prompt 08 não tem. É decisão de negócio, e está registrada como pendência.

## Alternativas descartadas

**Editar no lugar e confiar no AuditLog.** A trilha guarda o que mudou, mas não
é navegável por quem atende o balcão, e "o cliente aprovou R$ 890" precisa estar
na ficha, não num log de segurança.

**Marcar a anterior sempre como `superseded`.** Apagaria a distinção entre "o
cliente recusou" e "a loja refez antes de ele responder".
