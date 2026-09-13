# ADR-028 — Duplicidade: documento bloqueia, contato avisa

**Status:** Aceito · **Data:** Prompt 05

## Contexto

Cadastro duplicado é a doença crônica de qualquer base de clientes. Cada
duplicata parte o histórico, some com a garantia e faz dois atendentes olharem
telas diferentes da mesma pessoa.

A tentação é bloquear tudo que pareça repetido: documento, telefone, e-mail.

## Decisão

Dois tratamentos diferentes, porque são dois tipos de sinal:

| Sinal                           | Tratamento                                    |
| ------------------------------- | --------------------------------------------- |
| **CPF/CNPJ repetido no tenant** | **Bloqueio**, garantido por `UNIQUE` no banco |
| **Telefone ou e-mail repetido** | **Aviso**, com a lista de semelhantes         |

O bloqueio de documento oferece um **atalho para o cadastro existente**, em vez
de apenas recusar.

Não há mesclagem automática de duplicados.

## Motivo

O documento é um identificador **forte**: duas pessoas não têm o mesmo CPF.
Bloquear é correto, e a restrição precisa estar no banco — só ela resolve duas
gravações simultâneas, que "consultar antes de inserir" não resolve.

Telefone e e-mail são **fracos**, e os casos legítimos são cotidianos:

- casal usando o mesmo celular;
- empresa com um telefone só no balcão;
- pai cadastrando o e-mail dele para o filho;
- telefone comercial compartilhado por sócios.

Bloquear isso impediria cadastros verdadeiros todo dia, e o atendente
aprenderia a contornar — digitando um número falso, que é pior do que a
duplicata que se queria evitar.

O aviso respeita quem decide: o operador vê os semelhantes, com informação
suficiente para escolher entre abrir o existente ou cadastrar mesmo assim.

Mesclagem automática está fora porque errar ao fundir dois clientes é
**destrutivo e silencioso**: some histórico de alguém, e ninguém percebe até
precisar dele.

## Alternativas descartadas

| Alternativa                        | Por que não                                                            |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Bloquear telefone/e-mail repetidos | Impede casos legítimos diários; ensina o atendente a burlar            |
| Só avisar sobre documento repetido | Identificador forte duplicado é erro, não ambiguidade                  |
| Checar duplicidade só na aplicação | Furável por concorrência                                               |
| Mesclagem automática               | Destrutiva e silenciosa                                                |
| Recusar sem oferecer o existente   | Deixa o atendente preso: não pode cadastrar nem sabe onde está o certo |

## Consequências

- A restrição `uq_customers_tenant_document` faz três trabalhos: bloqueia o
  repetido, permite quantos clientes sem documento existirem (o MySQL considera
  cada `NULL` distinto) e vence a corrida entre dois cadastros simultâneos.
- O erro de duplicidade é traduzido para uma mensagem específica — "Já existe um
  cliente com este CPF nesta empresa" — e não para "violação de constraint".
- `findSimilarByContact` existe no domínio, sempre escopado ao tenant: o aviso
  **nunca** revela cliente de outra empresa.
- Mesclar duplicados continua sendo trabalho manual: abrir o cadastro certo,
  completar, e inativar o outro. Uma ferramenta de mesclagem, se for feita, terá
  sua própria decisão e seus próprios testes.
