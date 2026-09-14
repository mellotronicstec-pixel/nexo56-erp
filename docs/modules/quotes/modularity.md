# 12 perguntas de modularidade — `core.quotes`

| #   | Pergunta               | Resposta                                                                                                                                                                                                                                                              |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Classificação**      | `CORE`. Numa assistência o cliente aprova um preço antes do conserto; sem isso o fluxo para em Aguardando Aprovação sem saída comercial.                                                                                                                              |
| 2   | **Pode desativar?**    | **Não.** `CORE` não é desativável pelo tenant nem pelo plano; há teste verificando que a tentativa é recusada.                                                                                                                                                        |
| 3   | **Dependências**       | `core.service_orders` — todo orçamento pertence a uma OS. Transitivamente, Clientes e Equipamentos, pela própria OS.                                                                                                                                                  |
| 4   | **Dependentes**        | Peças/Estoque (10) usará a linha `part` como origem de necessidade; Compras (11), Financeiro (12) e Portal (17) consumirão o orçamento aprovado. Nenhum existe ainda.                                                                                                 |
| 5   | **Dados ao desativar** | Não se aplica. Se um dia fosse: **o orçamento permanece**. É registro histórico e comercial; o mecanismo de dependências impede ativação incoerente, nunca apaga dado. A integridade da OS não muda.                                                                  |
| 6   | **Frontend**           | Seção "Orçamentos" na ficha da OS e `/ordens-de-servico/[id]/orcamentos/[quoteId]`. Cada ponto verifica Effective Access no servidor; a seção só aparece para quem tem `quotes.view` na unidade da ordem.                                                             |
| 7   | **Backend/API**        | Server Actions sobre a camada de aplicação (`createQuote`, `saveQuoteDraft`, `sendQuote`, `approveQuote`, `rejectQuote`, `cancelQuote`, `reviseQuote`). Sem API pública — a regra mora no serviço para a futura API reusá-la.                                         |
| 8   | **Automações**         | **Nenhuma.** Sete tipos de evento são publicados no outbox; nenhum tem consumidor. O único job é a varredura de validade, que marca e publica — não decide nada sobre o aparelho.                                                                                     |
| 9   | **Permissões**         | Sete capacidades comerciais (`quotes.view` … `quotes.cancel`), avaliadas **na unidade da Ordem de Serviço**. Enviar e aprovar exigem também `service_orders.transition`, porque de fato movem a OS.                                                                   |
| 10  | **Plano**              | Entitlement `core.quotes` em todo plano, por ser CORE.                                                                                                                                                                                                                |
| 11  | **Reativação**         | Não se aplica. O dado estaria intacto de qualquer forma: nada é apagado.                                                                                                                                                                                              |
| 12  | **Histórico**          | **Sim, em três camadas.** `quote_timeline` guarda os fatos do orçamento; `service_order_timeline` guarda o fato resumido na ficha do aparelho; `audit_logs` guarda a trilha de segurança. Além disso, a **revisão** preserva cada versão proposta como linha própria. |

## Dependência formal

`core.quotes → core.service_orders` está declarada no grafo de
`feature_dependencies`, o único mecanismo usado. No banco, `ON DELETE RESTRICT`
garante que uma OS com orçamento não desapareça por acidente, e `CASCADE` garante
que itens e linha do tempo sigam o orçamento a que pertencem.

## Fronteira com quem ainda não existe

O módulo não importa nem escreve em nenhum módulo de estoque, compras,
financeiro, garantia, Portal ou comunicação — verificado por teste arquitetural
que inspeciona os imports e as tabelas referenciadas em `modules/quotes`.
