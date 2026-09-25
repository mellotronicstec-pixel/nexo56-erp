# Provedor Externo

## Nenhuma decisão de fornecedor foi tomada

Inspeção confirmada (nenhum ADR, variável de ambiente, dependência de
pacote ou documento menciona um provedor real de busca/marketplace de
peças): item 19/20 proíbem escolher um em silêncio. `PartSearchProvider`
é uma porta abstrata (`application/part-search-provider.ts`) — o domínio
e a UI nunca veem vendor nenhum.

`PartSearchProvider != AiGateway` (item 10, deliberado): esta porta
representa um catálogo/marketplace estruturado, nunca um modelo de
linguagem. As duas portas coexistem sem se misturar.

## Registro (mesmo padrão do AI Gateway e da Comunicação)

```
FORA DE PRODUÇÃO  -> CapturePartSearchProvider, deterministico
EM PRODUÇÃO       -> null, e a busca externa falha com
                      PART_SEARCH_PROVIDER_NOT_CONFIGURED
```

Não existe variável de ambiente que ligue a captura em produção
(`assertNotProduction()` dentro do próprio `search()`, não um guard
externo contornável). A busca **interna** nunca é afetada — ela é a
V1 inteira funcionando sem nenhum provedor real.

## Contrato estruturado

`PartSearchProviderResultItem`: `providerResultId`, `title`, `partNumber`,
`manufacturer`, `sourceName`, `price` (string decimal + `BRL`),
`availability` (`available`/`unavailable`/`unknown`), `leadTimeDays`,
`url`, `compatibilityData` (`exactFit`/`incompatible`/`note`),
`observedAt`. Nenhum campo de texto livre "para o sistema adivinhar" —
tudo validado por `domain/provider-result-schema.ts` (Zod) antes de virar
Candidate/Offer; item inválido é descartado individualmente, sem derrubar
o restante da resposta.

## Relatório do provedor (14 perguntas)

1. **Existe provedor real em produção?** Não.
2. **Que provedor é usado fora de produção?** Um provedor de captura
   determinístico, sem rede.
3. **A captura funciona em produção?** Não — `assertNotProduction()`
   lança de dentro do próprio método.
4. **Quem escolhe o provedor?** Só `infrastructure/provider-registry.ts`,
   do lado do servidor.
5. **A UI/domínio veem credencial?** Não, nunca.
6. **O que acontece sem provedor configurado?**
   `PART_SEARCH_PROVIDER_NOT_CONFIGURED`; busca interna continua.
7. **Timeout é finito?** Sim, 15s por padrão, ajustável só em teste.
8. **Retry agressivo?** Não — falha explícita, retry manual do usuário.
9. **O provedor pode inventar preço/estoque/prazo?** Não — todo campo
   nulo continua nulo; nada é inferido.
10. **O provedor pode confirmar compatibilidade sozinho?** Não — no
    máximo gera `provider_exact_fit_signal`, que sozinho só sustenta
    Provável/Alta Probabilidade (nunca Confirmada).
11. **Erro do provedor vaza detalhe técnico ao usuário?** Não — mensagem
    fixa em pt-BR; detalhe cru só em log sanitizado.
12. **Existe scraping não autorizado?** Não — nenhum acesso a rede
    existe nesta V1 (o boundary test garante ausência de `fetch`/`axios`
    no módulo inteiro).
13. **O backend busca (`fetch`) a URL do provedor?** Nunca — a URL só é
    validada (`http`/`https`) e entregue ao navegador do usuário.
14. **Quando um provedor real existir, o que muda?** Só
    `provider-registry.ts` — nenhuma mudança em domínio, aplicação ou UI.
