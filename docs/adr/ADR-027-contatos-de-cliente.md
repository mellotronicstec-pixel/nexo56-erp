# ADR-027 — Contatos como entidade, e WhatsApp como característica

**Status:** Aceito · **Data:** Prompt 05

## Contexto

Uma assistência precisa guardar mais de uma forma de falar com o cliente: o
celular, o telefone da esposa, o comercial, o e-mail do financeiro. E precisa
saber quais números têm WhatsApp, porque é por ali que o aviso de "aparelho
pronto" sai.

Dois desenhos se apresentam:

1. colunas fixas em `customers` — `telefone1`, `telefone2`, `email`, `whatsapp`;
2. tabela `customer_contacts`, com tipo, valor e metadados.

## Decisão

**Tabela própria** (opção 2), com `type`, `value`, `value_normalized`,
`is_whatsapp`, `label` e marcação de principal.

**WhatsApp é uma característica do telefone, não um contato separado**: um
booleano na linha do telefone, não outra linha com o mesmo número.

O **contato principal é um por cliente** — o primeiro da lista no formulário —
garantido por um índice único sobre `(customer_id, primary_marker)`, onde
`primary_marker` vale `1` no principal e `NULL` nos demais.

## Motivo

Colunas fixas quebram sempre no mesmo lugar: a terceira coluna acaba faltando, o
quarto telefone não cabe, e ninguém sabe de quem é o `telefone2`. O rótulo
livre ("Telefone da esposa") é o que torna o cadastro utilizável meses depois.

Sobre o WhatsApp: duplicar a linha só porque o mesmo número também é WhatsApp
criaria **dois registros que precisam ser mantidos em sincronia para sempre**.
Quando o cliente trocar de número, alguém atualiza um e esquece o outro — e o
sistema passa a ter duas verdades sobre o mesmo telefone.

Sobre o principal único: separar principal **por canal** (um telefone principal
e um e-mail principal) resolveria um problema que o produto ainda não tem. O
modelo mais simples que preserva evolução é um principal só; quando um canal
precisar do seu, a coluna `primary_marker` aceita a mudança sem migrar dado.

A garantia no banco existe porque a alternativa — "apaga os outros, marca este"
na aplicação — é furável por duas requisições simultâneas.

## Alternativas descartadas

| Alternativa                    | Por que não                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| `telefone1/2/3` em `customers` | A coluna que falta é sempre a próxima; sem rótulo, sem sentido         |
| WhatsApp como linha separada   | Duas verdades sobre o mesmo número, dessincronizadas na primeira troca |
| WhatsApp como `type` próprio   | Mesmo problema, com a aparência de modelagem correta                   |
| Principal por canal, já agora  | Complexidade sem caso de uso; a coluna aceita a evolução depois        |
| Principal só na aplicação      | Furável por concorrência                                               |

## Consequências

- A busca por telefone e e-mail passa pela tabela de contatos, com `EXISTS` para
  não multiplicar linhas nem estragar a contagem da paginação.
- A listagem carrega os contatos principais da página em **uma** consulta — duas
  no total, não uma por cliente.
- Na edição, a lista de contatos é substituída por inteiro: o formulário é a
  verdade sobre os contatos daquele cliente, e casar linha a linha traria
  complexidade que não paga o próprio custo neste domínio.
- Telefone repetido entre clientes é permitido (casal com um celular, empresa
  com telefone único) — ver [ADR-028](ADR-028-duplicidade-de-cliente.md).
