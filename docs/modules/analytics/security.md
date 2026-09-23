# Segurança do Painel

Respostas diretas às 12 perguntas do relatório de segurança obrigatório do
Prompt 18 (item 258).

**1. Como o tenant é aplicado?**
Toda consulta escrita neste módulo filtra por `tenantId = scope.tenantId`,
vindo do `TenantContext` autenticado — nunca de parâmetro de URL ou corpo
de requisição. `tests/unit/analytics-boundary.test.ts` verifica
estaticamente que cada adaptador de aplicação (exceto o financeiro, que
delega ao contexto inteiro) menciona `tenantId` no código; o isolamento em
si é provado por `tests/integration/analytics-dashboard.test.ts`
("isolamento de tenant").

**2. Como as unidades autorizadas são aplicadas?**
`AnalyticsScope.selectedUnitIds` é sempre a interseção entre o que a URL
pediu e `context.authorizedUnitIds` (membership do `TenantContext`,
carregada uma vez na sessão). Depois, por domínio, `unitsAuthorizedFor`
filtra ainda mais por `permissionsInScope(context, unitId)` — uma unidade
pode estar no escopo geral e mesmo assim ficar de fora de um cartão
específico, se a permissão daquele domínio só foi concedida em outra
unidade.

**3. O browser consegue escolher unidade não autorizada?**
Não. Um `unitId` que não está em `authorizedUnitIds` é descartado em
silêncio na resolução do escopo (nunca chega a nenhuma consulta). Testado
em `tests/unit/analytics-scope.test.ts` ("unidade não autorizada na URL
nunca aparece") e `tests/integration/analytics-dashboard.test.ts` ("pedir
explicitamente uma unidade NÃO autorizada devolve escopo vazio").

**4. "Todas as unidades" significa o quê?**
Todas as unidades em `context.authorizedUnitIds` — nunca todas as unidades
do tenant. Testado com um tenant de 3 unidades e um usuário membro de
apenas 2 (`tests/integration/analytics-dashboard.test.ts`, "usuário MEMBRO
de 2 das 3 unidades").

**5. Cartões escondidos também deixam de ser consultados?**
Sim. `DashboardQueryService` decide, por domínio, se o adaptador é chamado
**antes** de qualquer I/O acontecer (`quotesAllowed ? loadQuoteMetrics(...)
: Promise.resolve(null)`). Quando a decisão é negativa, o campo do
`DashboardView` é `null` — não um objeto com contagens zeradas, que a UI
(ou um chamador futuro da API) poderia confundir com "não há dados" em vez
de "sem acesso". Provado com dados reais no banco em
`tests/integration/analytics-dashboard.test.ts` ("feature desligada nunca
vaza contagem").

**6. Financeiro sem permissão aparece no payload?**
Não. `dashboard.finance` é literalmente `null` quando `finance.view` falta
— não existe um payload parcial nem um valor "0.00" que pudesse ser
confundido com dado real. Testado explicitamente.

**7. Feature OFF ainda consulta o domínio?**
Não. A checagem de feature (`checkManyAccess`) acontece antes da checagem
de permissão por unidade, e ambas acontecem antes de qualquer adaptador ser
invocado. Testado com dado real no banco para os 6 domínios opcionais
(Financeiro, Garantias, Agenda, Comunicação, Estoque, Compras): cada teste
cria registros que RETORNARIAM um número não-zero se a consulta rodasse, e
confirma que o campo é `null` com a feature desligada.

**8. Counts podem vazar módulo não autorizado?**
Não — mesma resposta da pergunta 5 e 7: a ausência é estrutural (`null`),
não uma escolha de renderização da UI. "Um cartão escondido no React não é
segurança se o dado continua saindo da consulta" (item 26) é exatamente o
que este desenho evita: a decisão de consultar ou não mora inteiramente no
servidor, antes do primeiro `await` de I/O.

**9. Cache é usado?**
Não. Todo número é uma live query (ver ADR-081). Não há `Cache-Control`
especial na rota, nem cache em memória, nem Redis — logo não há chave de
cache para acertar ou errar.

**10. Como cache evita cross-tenant/cross-unit?**
Não se aplica: não há cache no V1. Se um dia houver (ver `future.md`), a
chave precisará incluir tenant, unidades selecionadas e período — nunca a
URL sozinha, porque dois usuários do mesmo tenant com escopos de unidade
diferentes não podem compartilhar resultado.

**11. PII aparece em gráfico/tooltip?**
Não. Todas as 21 métricas são contagens ou somas agregadas — nenhuma
retorna nome de cliente, telefone, e-mail, número de série ou qualquer
identificador de registro individual. A distribuição por situação de OS e
a antiguidade de backlog são contagens por categoria, nunca listas de
registros. Onde há drill-down (status de OS, entradas no período), ele
navega para a tela oficial de Ordens de Serviço, que já aplica seu próprio
controle de acesso e mascaramento — o Painel não duplica nem contorna essa
camada.

**12. Drill-down revalida autorização?**
Sim, e da forma mais simples possível: os dois drill-downs existentes
(`os.status_distribution`, `os.created_in_period`) são links comuns
(`<a href>`) para `/ordens-de-servico`, uma página que já chama
`requireAccessForPage(FEATURES.CORE_SERVICE_ORDERS,
PERMISSIONS.SERVICE_ORDERS_VIEW)` e filtra pela unidade ativa da sessão —
exatamente a mesma revalidação que qualquer navegação direta para aquela
tela já sofre. O Painel não inventa uma segunda porta de entrada.

## SQL injection e parâmetros

Todo filtro (status, datas, `unitId`) passa por `drizzle-orm` com
`eq`/`inArray`/`gte`/`lte` parametrizados, ou por fragmentos `sql` com
interpolação segura de valor (nunca concatenação de string). Nenhum filtro
deste módulo monta SQL a partir de string concatenada.
