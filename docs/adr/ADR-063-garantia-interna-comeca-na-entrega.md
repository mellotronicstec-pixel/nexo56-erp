# ADR-063 — A garantia interna começa na entrega, não no pagamento

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 10, 11, 52, 74

## Contexto

Quando a garantia interna começa a contar? Três candidatos apareceram:

1. quando o orçamento é aprovado;
2. quando o cliente paga (evento `SERVICE_ORDER_FINANCIAL_SETTLED`, do
   Prompt 12);
3. quando o cliente leva o aparelho embora.

O caso que decide é rotineiro em assistência técnica: o cliente aprova por
telefone na terça, paga por PIX na quarta e só aparece para retirar na sexta.

Com (1), a contagem começaria com o aparelho ainda na bancada — o cliente
perderia dias de cobertura que pagou. Com (2), o mesmo problema, menor. Só (3)
corresponde à frase que o cliente entende: "três meses a partir de hoje".

## Decisão

**A garantia interna exige a Ordem de Serviço em `completed`, e a emissão é um
ato humano explícito.**

O workflow já tinha o ato formal de entrega: a transição
`awaiting_customer_pickup → completed`, cujo rótulo é literalmente "O cliente
retirou o aparelho". Não foi preciso inventar um marco novo — bastou usar o que
já significava exatamente isso.

`SERVICE_ORDER_FINANCIAL_SETTLED` **não é consumido** por este módulo. O evento
continua existindo e o comentário dele registra, no código, que a omissão é
deliberada.

## Por que não emitir automaticamente na conclusão

Porque emitir garantia é assumir um compromisso da empresa, e há atendimentos
que não geram garantia nenhuma: laudo sem conserto, recusa de orçamento,
limpeza simples, aparelho devolvido sem reparo. Emitir sozinho faria a loja
prometer cobertura sobre serviço que não executou.

A tela ajuda sem decidir: com a OS concluída, o bloco "Emitir garantia" aparece
preenchido com a política ativa. Falta uma pessoa clicar.

## Consequências

**Ganhamos:** a vigência corresponde ao que o cliente ouviu no balcão, e
nenhuma garantia nasce de um atendimento que não a mereceu.

**Pagamos:** um passo manual por OS. É o passo que representa a decisão.

**A tela esconde, o backend recusa:** `issueWarranty` verifica o status da OS
por conta própria. Esconder o formulário é conveniência; a regra mora no caso
de uso.
