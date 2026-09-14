# Matriz de sensibilidade de dados — Nexo56

Classificação que orienta log, auditoria, exportação, retenção e acesso
(Prompt 02, itens 43 e 86).

---

## Níveis

| Nível                    | Definição                                           | Regra operacional                                          |
| ------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| **Público**              | Pode ser exposto sem autenticação                   | Nenhuma restrição                                          |
| **Interno**              | Operacional da empresa, exige autenticação e tenant | Nunca cruza tenant                                         |
| **Pessoal (PII)**        | Identifica pessoa natural — LGPD                    | Minimização, nunca em log, redigido na auditoria           |
| **Financeiro**           | Valor, pagamento, custo, margem                     | Exige permissão específica; rastreável                     |
| **Técnico**              | Diagnóstico, laudo, procedimento                    | Interno; parte pode ir ao cliente                          |
| **Credencial / segredo** | Autentica ou autoriza                               | **Nunca** em log, auditoria, evento, export ou repositório |

---

## Classificação — dados existentes

| Dado                                           | Tabela                                            | Nível                                     | Tratamento atual                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Nome da empresa, slug                          | `tenants`                                         | Interno                                   | —                                                                                                                                             |
| Nome da unidade                                | `units`                                           | Interno                                   | —                                                                                                                                             |
| Nome do usuário                                | `users.name`                                      | **Pessoal**                               | Não vai para log                                                                                                                              |
| E-mail do usuário                              | `users.email`                                     | **Pessoal**                               | Não vai para log; normalizado                                                                                                                 |
| Hash de senha                                  | `users.password_hash`                             | **Credencial**                            | scrypt; redigido em log e auditoria                                                                                                           |
| Hash do token de sessão                        | `sessions.token_hash`                             | **Credencial**                            | SHA-256; o token nunca é gravado                                                                                                              |
| Hash do código de redefinição                  | `password_reset_tokens.token_hash`                | **Credencial**                            | SHA-256; o código nunca é gravado                                                                                                             |
| Resumo do dispositivo                          | `sessions.user_agent_summary`                     | **Pessoal** (baixo)                       | 120 caracteres, sem versão nem IP                                                                                                             |
| IP, user-agent completo                        | —                                                 | **Pessoal**                               | **Não coletados** (minimização)                                                                                                               |
| Papéis e permissões                            | `roles`, `permissions`                            | Interno                                   | —                                                                                                                                             |
| Trilha de auditoria                            | `audit_logs`                                      | Interno + **Pessoal** em `before`/`after` | Redação automática antes de gravar                                                                                                            |
| Payload de evento                              | `domain_events`                                   | Interno                                   | Não carrega credencial                                                                                                                        |
| Payload de job                                 | `jobs`                                            | Interno                                   | Não carrega credencial                                                                                                                        |
| `SESSION_SECRET`, `JOB_SECRET`, `DATABASE_URL` | ambiente                                          | **Credencial**                            | Nunca versionados; validados no startup                                                                                                       |
| Nome / razão social do cliente                 | `customers.name`                                  | **Pessoal**                               | Não vai para log; coluna normalizada só para busca                                                                                            |
| CPF / CNPJ                                     | `customers.document_digits`                       | **Pessoal (sensível por uso)**            | Só dígitos; nunca PK; único por tenant; redigido em log e auditoria                                                                           |
| Data de nascimento                             | `customers.birth_date`                            | **Pessoal**                               | Data civil, sem fuso                                                                                                                          |
| Telefone / e-mail do cliente                   | `customer_contacts.value`                         | **Pessoal**                               | Não vai para log                                                                                                                              |
| Endereço do cliente                            | `customer_addresses`                              | **Pessoal**                               | Só quando houver finalidade                                                                                                                   |
| Número de série do equipamento                 | `equipment.serial`                                | Interno                                   | Pode identificar indiretamente — tratado como dado do cliente                                                                                 |
| **Fotos do equipamento**                       | `equipment_media` + storage                       | **Pessoal** (podem conter terceiros)      | Fora de `public/`; chave opaca gerada pelo servidor; rota autenticada; EXIF (inclusive GPS) descartado no preparo                             |
| Legenda da foto                                | `equipment_media.caption`                         | **Pessoal** (baixo)                       | Texto livre do atendente                                                                                                                      |
| Estado físico de entrada                       | `equipment_intake_conditions`                     | Interno                                   | Estado de entrada, **não** diagnóstico                                                                                                        |
| Sugestão de leitura de etiqueta                | `equipment_label_readings.fields`                 | Interno                                   | Não contém imagem; a imagem nunca vai para log                                                                                                |
| **Relato do cliente**                          | `service_orders.customer_report`                  | **Pessoal** (incidental)                  | Texto livre: pode conter nome de terceiro, endereço ou circunstância pessoal. Nunca vai para log; a auditoria guarda só o tamanho na abertura |
| Relato anterior, após correção                 | `audit_logs.before`                               | **Pessoal** (incidental)                  | Exceção consciente: o texto anterior vai por inteiro, senão "relato alterado" não permitiria reconstruir o que o cliente disse                |
| Observações internas da OS                     | `service_orders.internal_notes`                   | Interno                                   | Da equipe; não é apresentado ao cliente nem ao futuro Portal                                                                                  |
| Número da OS                                   | `service_orders.number`                           | Interno                                   | Identificador de documento; sequencial por empresa                                                                                            |
| Linha do tempo da OS                           | `service_order_timeline`                          | Interno                                   | `summary`, `metadata` e `reason` nunca carregam o relato — coberto por teste                                                                  |
| Motivo de transição ou cancelamento            | `service_order_timeline.reason`                   | Interno                                   | Texto humano escrito pela equipe. Fica no histórico e na auditoria; não é apresentado ao cliente                                              |
| Tarefas do fluxo                               | `service_order_tasks`                             | Interno                                   | `description` de "Buscar Peça" é texto livre da equipe; não carrega dado do cliente                                                           |
| Observações do orçamento para o cliente        | `quotes.customer_notes`                           | Interno                                   | Escrito para o cliente ler. Sai no futuro PDF e no futuro Portal — separado do recado interno de propósito                                    |
| Observações internas do orçamento              | `quotes.internal_notes`                           | Interno                                   | Recado da equipe; nunca vai ao cliente                                                                                                        |
| Motivo de recusa ou cancelamento               | `quotes.decision_reason`                          | Interno                                   | Texto livre de pessoa; pode conter circunstância pessoal incidental                                                                           |
| Valores e itens do orçamento                   | `quotes`, `quote_items`                           | Interno                                   | Preço praticado é informação comercial. Nunca vai para log nem para payload de evento                                                         |
| Catálogo de peças                              | `parts`                                           | Interno                                   | **Não é dado pessoal.** Nome, código, fabricante e referência descrevem um objeto, não uma pessoa                                             |
| Saldo, movimentação e reserva                  | `stock_*`                                         | Interno                                   | **Não é dado pessoal.** Custo e margem são informação comercial; nunca vão para log                                                           |
| Autor da movimentação                          | `stock_movements.actor_id`                        | Interno                                   | Referência a usuário, como toda coluna de autoria. Não é PII em si; identifica quem operou                                                    |
| Referência e motivo da movimentação            | `stock_movements.reference/reason`                | Interno                                   | Texto livre de pessoa. Orientação: nota fiscal, fornecedor ou motivo operacional — **nunca** dado de cliente                                  |
| Razão social / nome do fornecedor              | `suppliers.name`                                  | Interno⁸                                  | Empresa, não pessoa — **exceto** quando `kind = 'individual'`, e aí é dado pessoal                                                            |
| CPF / CNPJ do fornecedor                       | `suppliers.document_digits`                       | **Pessoal (sensível por uso)**            | Só dígitos; opcional; único por tenant; a mesma redação automática de `customers.document_digits`                                             |
| Telefone / e-mail do fornecedor                | `suppliers.phone/email`                           | Interno⁸                                  | Contato comercial da empresa                                                                                                                  |
| Endereço do fornecedor                         | `suppliers` (colunas inline)                      | Interno⁸                                  | Endereço comercial                                                                                                                            |
| **Contatos do fornecedor**                     | `supplier_contacts`                               | **Pessoal**                               | Nome, telefone e e-mail do **vendedor** — pessoa física dentro de cadastro de empresa. Não vai para log nem para payload de evento            |
| Condições comerciais e observações             | `suppliers.commercial_terms/notes`                | Interno                                   | Informação comercial: prazo, pedido mínimo, desconto negociado. Nunca vai para log                                                            |
| Valores de compra                              | `purchase_orders`, `purchase_order_items`         | Interno                                   | Custo do fornecedor é informação comercial sensível. Nunca vai para log nem para payload de evento                                            |
| Histórico de preço pago                        | `purchase_price_history`                          | Interno                                   | Append-only. Revela a política de compra da empresa; é o dado comercial mais sensível do módulo                                               |
| Justificativa da necessidade                   | `purchase_needs.justification`                    | Interno                                   | Texto livre da equipe. Pode citar a OS; **não** deve carregar dado de cliente                                                                 |
| Motivo de cancelamento de pedido               | `purchase_orders.cancel_reason`                   | Interno                                   | Texto humano da equipe                                                                                                                        |
| Número e data da nota                          | `purchase_receipts.document_number/document_date` | Interno                                   | Documento fiscal entre empresas                                                                                                               |
| Linha do tempo do pedido                       | `purchase_order_timeline`                         | Interno                                   | `summary` cita peça e quantidade — objeto, não pessoa                                                                                         |

⁸ **O fornecedor é uma empresa, e por isso o cadastro é Interno e não Pessoal.**
A exceção é real e está no modelo: `suppliers.kind = 'individual'` existe porque
a assistência compra do autônomo da esquina — e aí nome, CPF, telefone e
endereço são de uma pessoa física, com o mesmo tratamento do cadastro de
clientes. `supplier_contacts` é **sempre** dado pessoal, qualquer que seja o
`kind`: é o nome do vendedor.

### Redação automática

`redact()` (`src/core/logging/logger.ts`) é aplicada em **log e auditoria**, e
neutraliza: `password`, `senha`, `password_hash`, `token`, `token_hash`,
`secret`, `session_secret`, `job_secret`, `authorization`, `cookie`, `cpf`,
`creditcard` — insensível a maiúsculas, hífen e underline, recursivo em objetos
e listas. Coberto por teste.

---

## Classificação — dados futuros

| Dado                        | Entidade futura      | Nível          | Exigência antecipada                              |
| --------------------------- | -------------------- | -------------- | ------------------------------------------------- |
| Defeito, diagnóstico, laudo | `service_orders`     | **Técnico**    | Parte vai ao cliente; linguagem revisada          |
| Preço, custo, margem        | `quotes`, `payments` | **Financeiro** | Custo exige permissão distinta de preço           |
| Forma de pagamento          | `payments`           | **Financeiro** | **Nunca** armazenar dado completo de cartão       |
| Token público do QR         | (futuro)             | **Credencial** | Opaco, não enumerável, escopo limitado, revogável |

### Regras firmadas agora

1. **CPF/CNPJ nunca é chave primária** e nunca é armazenado apenas formatado —
   guarda-se a forma normalizada, com a formatação feita na apresentação.
2. **Dado de cartão de crédito não é armazenado.** Pagamento com cartão guarda
   apenas referência do adquirente.
3. **Nada de criptografia caseira** (item 43). Se houver necessidade de cifrar
   em repouso, usa-se recurso do banco ou biblioteca estabelecida, com ADR.
4. **Token público não carrega PII** e não substitui autorização no servidor.
5. **Mídia nunca fica em diretório público** (ADR-030). Arquivo em `public/` é
   acessível a quem descobrir a URL, e foto de equipamento pode conter a
   etiqueta com dados do cliente, uma nota fiscal sobre a bancada ou o interior
   da casa de alguém. O acesso passa por sessão, permissão e tenant, e mídia de
   outra empresa responde **404** — um 403 confirmaria que ela existe.
6. **Metadado de imagem é descartado, não filtrado** (ADR-031). O preparo no
   navegador reexporta a foto como JPEG: o arquivo que sobe é novo, com os
   pixels e mais nada — a geolocalização do EXIF não tem como sobreviver.
7. **A imagem nunca vai para o log.** O log da leitura de etiqueta registra
   provider, status, duração e tamanho — nada do conteúdo.
8. **Texto livre de cliente não vai para log nem para evento.** O relato entra na
   auditoria só como tamanho na abertura, e como valor anterior quando é
   corrigido — nunca no log da aplicação, nunca no payload do evento.
9. **Observação interna é separada do relato desde o modelo**, em coluna própria,
   para que o futuro Portal do cliente possa mostrar um sem arrastar o outro.
10. **Payload de evento de Compras não carrega dado pessoal** (Prompt 11).
    `SUPPLIER_CREATED` leva `supplierId` e `kind`, e nada mais — nome, documento
    e contato ficam na tabela, onde a autorização os protege.
11. **Custo de compra nunca vai para log** (Prompt 11). O que a empresa paga ao
    fornecedor é informação comercial sensível: o log estruturado registra
    módulo, operação e identificador do pedido, nunca valores.
