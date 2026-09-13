# ADR-035 — Um recebimento origina uma Ordem de Serviço

**Status:** Aceito · **Data:** Prompt 07

## Contexto

O Prompt 06 criou o recebimento: a entrada física do aparelho, com acessórios,
inspeção e fotos. O Prompt 07 cria a OS, que normalmente nasce dele.

A cardinalidade precisa ser decidida explicitamente, porque cada escolha tem
consequência imediata sobre quem é o dono dos acessórios e das fotos daquele dia.

Três opções:

1. **1:1** — um recebimento, uma ordem.
2. **1:N** — um recebimento, várias ordens (uma por defeito, por exemplo).
3. **N:M** — uma ordem cobrindo vários recebimentos.

## Decisão

**1:1**, garantida no banco por `uq_service_order_intake (tenant_id, intake_id)`.

A OS também pode existir **sem** recebimento (`intake_id` nulo). Como o MySQL
trata cada `NULL` como distinto no índice único, essas ordens convivem sem
limite.

## Motivo

O recebimento é um **acontecimento**: um aparelho, uma entrada, um conjunto de
acessórios, uma inspeção, um conjunto de fotos. A OS é o **trabalho** sobre
aquilo.

Com 1:N, a primeira pergunta sem resposta aparece de imediato: de qual das três
ordens são os acessórios? Qual delas devolve o controle remoto ao cliente? Qual
carrega a foto do risco na tampa? Ou se duplica a informação nas três — e as
três divergem no primeiro ajuste — ou se escolhe uma como principal, que é a
opção 1:1 com passos extras.

Com N:M, o problema piora: o cliente traz dois aparelhos, e uma ordem única
cobriria ambos. Mas orçamento, garantia e prazo são por aparelho. A ordem
multi-aparelho existiria só para poupar cliques na abertura, e cobraria isso em
toda etapa seguinte.

**Por que permitir OS sem recebimento.** Recusar obrigaria o atendente a inventar
um recebimento que não aconteceu — o aparelho que já estava na bancada, o retorno
combinado por telefone, a empresa que traz a máquina sem passar pelo balcão. Dado
falso para satisfazer o sistema é pior do que um vínculo ausente.

## Consequências

- A interface reflete a regra: quando o recebimento já tem ordem, o atalho deixa
  de oferecer "criar" e passa a levar para a ordem existente.
- Tentar criar a segunda devolve mensagem clara em português, com o caminho para
  a que existe — não um erro técnico.
- A restrição é do banco, então nem SQL direto nem um segundo caminho de criação
  a contorna.
- **Relaxar para 1:N depois é possível** e não destrutivo: basta remover o índice
  único, uma vez que exista a regra dizendo quem é a ordem principal do
  recebimento.
- Um aparelho que volta três vezes tem três recebimentos e três ordens, cada uma
  com o estado físico daquele dia — que é o histórico que a assistência consulta.

## Alternativas descartadas

**1:N sem ordem principal.** Acessórios, inspeção e fotos ficariam sem dono
claro.

**Cópia dos dados do recebimento para dentro da OS.** Criaria duas verdades sobre
o mesmo atendimento; a segunda ficaria desatualizada no primeiro ajuste. A ficha
da OS **lê** do recebimento.
