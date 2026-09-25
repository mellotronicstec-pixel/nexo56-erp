# Privacidade e Segurança

## Dados que saem do Nexo56 (quando há provedor externo)

Apenas: termo de busca normalizado, código de peça (quando informado),
tipo/marca/modelo do equipamento. **Nunca**: nome do cliente, CPF/CNPJ,
telefone, e-mail, endereço, dado financeiro, "relato do cliente" (item
28 — a busca precisa de identificação técnica, não da história do
cliente), ou o número de série do equipamento por padrão (item 27).

## PII armazenada pelo módulo

**Nenhuma.** `part_search_sessions.query_term` é o termo técnico digitado
— validado a 200 caracteres, nunca um campo de texto livre pensado para
PII. Nenhuma tabela do módulo tem coluna de nome/documento/contato de
cliente. `equipment_id`/`service_order_id` são referências técnicas, não
cópias de dado pessoal.

## Prompt injection (quando um provedor real existir)

Texto de provedor é conteúdo, nunca instrução — mesmo princípio do
Nexo56 AI (ADR-085). Como esta V1 não tem enriquecimento de IA sobre o
texto do provedor (ver `future.md`), o risco concreto hoje é limitado à
exibição segura do título/descrição (texto puro, nunca HTML renderizado —
item 168).

## Resultados externos são dado não confiável

Título, descrição e URL vêm de fora. Nunca renderizados como HTML/script;
URL validada (só `http`/`https`, nunca `javascript:`/`data:`) antes de
virar link clicável; o backend **nunca busca** essa URL (sem SSRF
possível — o teste de arquitetura garante ausência de `fetch`/`axios` no
módulo inteiro).

## Segurança (12 perguntas)

1. **XSS pelo título/URL do provedor?** Não — texto puro, URL validada.
2. **SQL cru?** Não — só Drizzle parametrizado.
3. **Execução arbitrária (`eval`/`Function`/`child_process`)?** Não —
   coberto por teste de arquitetura.
4. **SSRF (backend busca URL de terceiro)?** Não — o backend nunca faz
   essa requisição; só o navegador do usuário, depois de validada.
5. **Scraping não autorizado?** Não — nenhum acesso a rede nesta V1.
6. **Credencial de provedor alcança o cliente?** Não — seleção só em
   `provider-registry.ts`, servidor.
7. **IDOR (ver sessão/candidate de outro tenant)?** Não —
   `getSessionResults` filtra por `tenantId` e autoriza a unidade;
   testado com dois tenants reais.
8. **Enumeração de sessão?** IDs são UUIDv7, não sequenciais; toda
   consulta exige tenant+autorização.
9. **Rate limiting?** Reservado para quando um provedor real existir —
   nenhuma quota comercial nesta V1 (nada para limitar contra vendor
   nenhum).
10. **Double-click cria duas sessões?** Pode — duas buscas idênticas são
    legítimas (item 123). O que não duplica é a necessidade de compra
    (idempotência por reaproveitamento, ver `purchasing-integration.md`).
11. **Erro do provedor vaza stack/segredo?** Não — mensagem fixa,
    detalhe técnico só em log sanitizado.
12. **Money usa float em algum ponto?** Não — `Money`/centavos
    (`bigint`) em todo o caminho; DB em `DECIMAL(14,2)`.

## Confirmação: nenhuma PII enviada automaticamente

Testado explicitamente: o contexto do equipamento montado a partir da OS
carrega só `kind`/`brand`/`model` — nunca `customerReport`, nunca dado de
`customers`, nunca serial por padrão.
