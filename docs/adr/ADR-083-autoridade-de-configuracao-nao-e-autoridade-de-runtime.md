# ADR-083 — Autoridade de configuração não é autoridade de runtime

**Status:** Aceito
**Data:** Prompt 19 — Motor de Automações
**Itens atendidos:** 64, 68, 72, 89, 90, 219/220

## Contexto

O Motor de Automações executa ações que, para qualquer outra origem no
sistema, exigem uma permissão RBAC verificada contra um `TenantContext` de
sessão (`authorize(context, { permission, featureKey })`). Mas o Motor roda
dentro de um `JobHandler`, acionado por um evento de domínio ou por um tick
de relógio — não existe sessão de usuário nenhuma nesse momento.
`TenantContext` documenta explicitamente, no próprio arquivo que o define,
que só pode ser construído a partir de uma sessão válida no servidor.

A saída mais rápida seria fabricar um contexto sintético — um "usuário
sistema" com todas as permissões — para satisfazer as funções existentes.
Isso violaria o contrato do `TenantContext` e criaria exatamente o
"superusuário mágico" que o item 4 do Prompt 19 proíbe: um caminho de código
com autoridade que ninguém concedeu a ninguém.

## Decisão

Separar explicitamente dois momentos de autorização, cada um com sua própria
checagem:

1. **Tempo de configuração** — quando um humano cria, edita, habilita,
   desabilita ou arquiva uma regra pela UI, a permissão é checada com o
   `TenantContext` **real** dessa pessoa
   (`assertManageAuthority`/`assertActionPermissions` em `rule-service.ts`).
   Isto é RBAC padrão, sem exceção nenhuma.

2. **Tempo de runtime** — quando o Motor dispara a regra já configurada, ele
   não revalida permissão de usuário (não há usuário atuando; a autorização
   já foi dada por quem configurou). O que ele revalida, a cada disparo, é
   **disponibilidade de feature** (`checkFeatureEnabledForTenant`) e
   **invariantes de domínio** do módulo-alvo (existe contato principal?
   template ativo? feature do módulo-alvo ligada?).

Os dois pontos de entrada que o Motor chama
(`createMessageFromAutomation`, `createTaskFromAutomation`) foram
adicionados especificamente para viver ao lado das funções existentes
(`createMessage`, `createTask`) sem `authorize()`, aceitando um contexto
estrutural mínimo (`Pick<TenantContext, 'tenantId'>` e variantes, via
alargamento de tipo dos helpers compartilhados — mudança aditiva, sem efeito
para quem já os chamava com um `TenantContext` completo).

## Por que isto não é um bypass

Não é uma exceção "só para automação passar" — é o reconhecimento de que
autorização de **configurar um comportamento futuro** e autorização de
**executar um comportamento já configurado** são perguntas diferentes, e o
sistema já tinha um precedente para a segunda pergunta sem sessão: o Portal
do Cliente (Prompt 17) usa exatamente `checkFeatureEnabledForTenant` sem
`TenantContext` de sessão, pelo mesmo motivo estrutural.

## Alternativas consideradas

- **`TenantContext` sintético com todas as permissões.** Rejeitada: viola o
  contrato documentado do próprio tipo e não tem como ser auditada como
  autorização real — é indistinguível de um bug de escalonamento de
  privilégio.
- **Reautorizar contra o usuário que criou a regra, a cada disparo.**
  Rejeitada: a permissão desse usuário pode ter mudado (ou o usuário pode
  ter sido desativado) sem que a regra devesse parar de funcionar — a
  autorização de configuração já foi dada no momento em que a regra foi
  salva; revalidar identidade de pessoa a cada execução acopla o Motor ao
  ciclo de vida de contas de usuário, o que nenhuma outra automação do
  sistema (jobs recorrentes existentes) faz.
- **Um "papel de sistema" com permissões fixas, versionado.** Rejeitada por
  redundância: o catálogo fechado (`ADR-082`) já limita o raio de dano
  estruturalmente; um papel de sistema adicionaria uma segunda fonte de
  autoridade para manter sincronizada sem benefício de segurança real.

## Consequências

- Qualquer ação nova adicionada ao catálogo precisa, por convenção, de um
  ponto de entrada `*FromAutomation` próprio no módulo-alvo — nunca reusar
  a função autorizada por usuário passando um contexto forjado.
- Revogar a permissão de um usuário não desliga regras que ele configurou
  no passado — desligar uma regra é uma ação explícita
  (`setRuleEnabled`/`archiveRule`), não um efeito colateral de RBAC.
- Se o plano/feature de um tenant mudar, o comportamento do Motor muda no
  próximo disparo, sem esperar ninguém reeditar a regra — porque a checagem
  de feature acontece em runtime, não só na criação.
