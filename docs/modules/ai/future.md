# Fora de escopo deste prompt

Documentado sem implementar (item 211): o próximo prompt precisa saber o
que já foi pensado e deliberadamente adiado, sem reabrir a discussão do
zero.

## Prompt 21 — Busca de Peças por IA

Não iniciado. `AiGateway`, o registry de provedor e o padrão de catálogo
fechado (task + surface) já são genéricos o bastante para acrescentar as
tasks e surfaces desse prompt sem reconstruir a fundação — mas nenhum
arquivo desse escopo foi criado aqui.

## Prompt 22 — Base de Conhecimento / Diagnóstico

Não iniciado. `GERAR_PARECER_TECNICO` explicitamente **não** consulta
nenhuma base de conhecimento hoje — só o contexto já registrado e
autorizado da entidade. Embeddings e busca vetorial são deste prompt, não
deste.

## Assistente conversacional

Fora de escopo por decisão explícita (itens 6/7): sem chat aberto, sem
prompt livre, sem memória de conversa entre chamadas. Cada chamada de
`generateAiDraft` é independente — não existe "sessão de conversa" com a
IA.

## Streaming

V1 devolve o resultado completo, de uma vez. Nenhuma UI de streaming
parcial foi construída.

## Provider failover / múltiplos provedores por tenant

`provider-registry.ts` hoje resolve um único provedor global (captura fora
de produção, nenhum em produção). Failover entre provedores e provedor por
tenant não existem — quando um provedor real for adotado, essa decisão é
do prompt que o introduzir.

## UI de seleção de provedor

Não existe, e não deveria existir na V1: a escolha de provedor é decisão de
infraestrutura, do lado do servidor — nunca uma opção exposta ao usuário
final ou ao administrador do tenant.

## Cofre de segredos avançado

Prompt 25. Hoje, quando um provedor real existir, a credencial usa o mesmo
mecanismo de variável de ambiente/config já empregado pelo resto do
sistema — nenhuma infraestrutura nova de segredo foi construída aqui.

## Analytics de custo

Prompt 24 (comercial/SaaS). Nenhum cálculo de custo monetário está
implementado — `ai_requests` guarda contagem de caracteres e, quando
disponível, contagem de tokens informada pelo provedor, nunca um valor em
dinheiro.

## Automações com ação de IA

O Motor de Automações (Prompt 19) não ganhou nenhuma ação nova neste
prompt. Uma ação futura ("gerar rascunho automaticamente ao entrar em tal
status", por exemplo) exigiria decisão própria sobre humano-no-loop — hoje
incompatível com o princípio de que toda sugestão de IA exige revisão
humana antes de qualquer efeito.

## IA no Portal do Cliente

Não implementado. O Portal (Prompt 17) não importa o módulo `ai`.

## OCR / IA de imagem

Fora de escopo — este prompt é só texto. Não confundir com a leitura de
etiqueta do Prompt 06 (`equipment_label_readings`), que é uma capacidade
diferente e anterior, sem relação com o Nexo56 AI deste prompt.

## Voz

Fora de escopo.

## Prompt editável pelo usuário

V1 mantém os prompts internos fixos, versionados em código
(`task-catalog.ts`, `prompt-builder.ts`) — não editáveis por tenant nem por
usuário. Uma futura customização de prompt por tenant exigiria pensar de
novo toda a superfície de prompt injection e a guarda de significado
técnico — não é uma extensão trivial do desenho atual.
