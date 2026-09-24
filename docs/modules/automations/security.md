# Segurança: autoridade de configuração ≠ autoridade de runtime

Ver `ADR-083` para a decisão completa; este documento resume o comportamento.

## O problema

`TenantContext` só pode ser construído a partir de uma sessão válida no
servidor (contrato documentado no próprio arquivo que o define) — o Motor,
rodando dentro de um `JobHandler` acionado por evento ou por tick de
relógio, **não tem sessão nenhuma**. Fabricar um `TenantContext` sintético
("usuário fantasma com todas as permissões") violaria esse contrato e criaria
exatamente o "superusuário mágico" que o item 4 do Prompt 19 proíbe.

## A solução: dois momentos, duas checagens diferentes

**Configuração (tempo de escrita da regra):** quando um humano cria, edita,
habilita ou arquiva uma regra pela UI, a permissão (`automations.manage` +
permissão de cada ação) é checada com o `TenantContext` **real** dessa
pessoa, no escopo da regra — `assertManageAuthority`/`assertActionPermissions`
em `rule-service.ts`. Isto é RBAC de verdade, de gente de verdade.

**Runtime (tempo de disparo):** quando o Motor processa um evento ou um
tick, ele **não revalida permissão de usuário nenhum** — a regra já foi
autorizada quando foi salva. O que ele revalida, a cada disparo, é:

- **Disponibilidade de feature** — `checkFeatureEnabledForTenant`, a mesma
  função que o Portal do Cliente já usa (Prompt 17) precisamente porque
  também não tem `TenantContext` de sessão. `automation.core` e a feature de
  cada ação (`communications.core`, `operations.agenda`) são checadas de
  novo a cada execução, não só na criação da regra — se o plano do tenant
  mudar depois, o comportamento muda imediatamente, sem esperar a regra ser
  reeditada.
- **Invariantes de domínio** — ex.: existe contato principal no canal do
  modelo? O template está ativo? A regra ainda está habilitada e não
  arquivada?

Nenhum dos dois pontos de entrada usados pelo Motor
(`createMessageFromAutomation`, `createTaskFromAutomation`) chama
`authorize()` — eles vivem ao lado das funções que chamam (que continuam
exigindo permissão normalmente para todo o resto do sistema), com a mesma
assinatura de contexto reduzida (`Pick<TenantContext, 'tenantId'>` e
variantes), mudança estrutural sem efeito colateral para quem já os chamava.

## O que isso NÃO significa

- Não significa que o Motor pode fazer qualquer coisa: ele só pode chamar as
  duas funções `*FromAutomation` que existem, e cada uma delas ainda checa
  sua própria feature e suas próprias invariantes.
- Não significa bypass de permissão "só desta vez": a permissão de
  **configurar** a regra já foi cobrada de quem a criou; o Motor não está
  agindo como esse usuário nem como ninguém — está executando uma decisão já
  autorizada, do mesmo jeito que um `cron` executando um script que uma
  pessoa autorizada aprovou não precisa "logar como" ninguém para rodar.

## Superfícies fechadas por catálogo (defesa em profundidade)

Mesmo que a distinção acima falhasse por algum bug, o **raio de dano** é
travado pelo catálogo fechado: o Motor só pode, no máximo, mandar uma
mensagem usando um modelo **que já existia e já foi aprovado** para aquele
canal, ou criar uma tarefa de Agenda com **texto estático**. Não há caminho
de código que aceite SQL, HTTP ou template dinâmico vindos de uma regra —
provado em `tests/unit/automations-boundary.test.ts` plantando dados reais e
checando sua ausência (nunca por `vi.spyOn`/`vi.mock`, convenção do
repositório desde o Prompt 18).
