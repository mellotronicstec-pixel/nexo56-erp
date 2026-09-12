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

| Dado                                           | Tabela                 | Nível                                     | Tratamento atual                        |
| ---------------------------------------------- | ---------------------- | ----------------------------------------- | --------------------------------------- |
| Nome da empresa, slug                          | `tenants`              | Interno                                   | —                                       |
| Nome da unidade                                | `units`                | Interno                                   | —                                       |
| Nome do usuário                                | `users.name`           | **Pessoal**                               | Não vai para log                        |
| E-mail do usuário                              | `users.email`          | **Pessoal**                               | Não vai para log; normalizado           |
| Hash de senha                                  | `users.password_hash`  | **Credencial**                            | scrypt; redigido em log e auditoria     |
| Hash do token de sessão                        | `sessions.token_hash`  | **Credencial**                            | SHA-256; o token nunca é gravado        |
| IP, user-agent                                 | —                      | **Pessoal**                               | **Não coletados** (minimização)         |
| Papéis e permissões                            | `roles`, `permissions` | Interno                                   | —                                       |
| Trilha de auditoria                            | `audit_logs`           | Interno + **Pessoal** em `before`/`after` | Redação automática antes de gravar      |
| Payload de evento                              | `domain_events`        | Interno                                   | Não carrega credencial                  |
| Payload de job                                 | `jobs`                 | Interno                                   | Não carrega credencial                  |
| `SESSION_SECRET`, `JOB_SECRET`, `DATABASE_URL` | ambiente               | **Credencial**                            | Nunca versionados; validados no startup |

### Redação automática

`redact()` (`src/core/logging/logger.ts`) é aplicada em **log e auditoria**, e
neutraliza: `password`, `senha`, `password_hash`, `token`, `token_hash`,
`secret`, `session_secret`, `job_secret`, `authorization`, `cookie`, `cpf`,
`creditcard` — insensível a maiúsculas, hífen e underline, recursivo em objetos
e listas. Coberto por teste.

---

## Classificação — dados futuros

| Dado                           | Entidade futura      | Nível                                | Exigência antecipada                                                                 |
| ------------------------------ | -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| Nome do cliente                | `clients`            | **Pessoal**                          | Minimização; base legal de execução de contrato                                      |
| CPF / CNPJ                     | `clients`            | **Pessoal (sensível por uso)**       | Armazenar **normalizado** (só dígitos); nunca PK; unicidade por tenant; nunca em log |
| Telefone, e-mail do cliente    | `client_contacts`    | **Pessoal**                          | Preferência de comunicação respeitada                                                |
| Endereço                       | `addresses`          | **Pessoal**                          | Só quando houver finalidade (coleta/entrega)                                         |
| Número de série do equipamento | `equipments`         | Interno                              | Pode identificar indiretamente — tratar com cuidado                                  |
| Fotos do equipamento           | `attachments`        | **Pessoal** (podem conter terceiros) | Acesso autenticado; storage com chave opaca                                          |
| Defeito, diagnóstico, laudo    | `service_orders`     | **Técnico**                          | Parte vai ao cliente; linguagem revisada                                             |
| Preço, custo, margem           | `quotes`, `payments` | **Financeiro**                       | Custo exige permissão distinta de preço                                              |
| Forma de pagamento             | `payments`           | **Financeiro**                       | **Nunca** armazenar dado completo de cartão                                          |
| Token público do QR            | (futuro)             | **Credencial**                       | Opaco, não enumerável, escopo limitado, revogável                                    |

### Regras firmadas agora

1. **CPF/CNPJ nunca é chave primária** e nunca é armazenado apenas formatado —
   guarda-se a forma normalizada, com a formatação feita na apresentação.
2. **Dado de cartão de crédito não é armazenado.** Pagamento com cartão guarda
   apenas referência do adquirente.
3. **Nada de criptografia caseira** (item 43). Se houver necessidade de cifrar
   em repouso, usa-se recurso do banco ou biblioteca estabelecida, com ADR.
4. **Token público não carrega PII** e não substitui autorização no servidor.
