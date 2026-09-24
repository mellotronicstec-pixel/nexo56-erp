# Fora da V1 (deliberadamente)

O Prompt 19 fecha o Motor com dois trigger families e duas ações — de
propósito, não por falta de tempo. O que fica de fora, e por quê:

- **Webhook de saída (chamar uma URL externa).** Exigiria validar destino,
  assinatura, retry de rede, e uma superfície de segurança inteira
  (SSRF, allowlist de host) que este prompt explicitamente proíbe abrir
  agora (item 4: "nunca chamar URL arbitrária"). Fica para um prompt
  dedicado que trate isso como cidadão de primeira classe, não como terceira
  ação encaixada.
- **Ação de IA / geração de texto livre.** O Motor de Automações V1 só
  executa passos determinísticos e auditáveis — toda ação usa texto
  estático da própria regra (ver `action-catalog.md`). Introduzir geração
  dinâmica muda a natureza de auditoria do sistema e merece decisão própria.
- **OR nas condições / grupos aninhados.** V1 é só `ALL` (E lógico) — ver
  `conditions.md`. Adicionar `OR`/agrupamento é extensão aditiva do
  validador existente, sem quebrar regras já salvas (o `schemaVersion` na
  própria definição permite migrar o formato depois).
- **Mais gatilhos e ações no catálogo.** O catálogo é fechado por
  desenho — adicionar um novo gatilho/ação é uma entrada nova em
  `trigger-catalog.ts`/`action-catalog.ts`, nunca liberar string livre.
  Candidatos óbvios para o próximo prompt: `quote.approved`,
  `warranty.expiring_soon`, ação `finance.create_reminder` (sem nunca
  escrever o Financeiro diretamente — teria que nascer como serviço oficial
  do próprio módulo Financeiro, assim como Comunicação e Agenda hoje).
- **Precisão de agendamento sub-5-minutos.** Ligada à frequência do job
  recorrente atual (ver `scheduling.md`); um worker permanente resolveria
  sem mudar nenhuma regra.
- **Reordenar/pausar ações individualmente dentro de uma execução em
  andamento.** V1 roda a lista de ações da versão, em ordem, até o fim ou
  até falhar; não há pausa manual no meio.

Nenhum destes itens tem código parcial neste commit — nenhuma tabela, rota
ou config schema "preparando o terreno" para eles. Quando chegarem, chegam
como trabalho novo, revisado com a mesma rigidez do resto do módulo.
