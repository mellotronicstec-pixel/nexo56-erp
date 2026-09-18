# Nexo56 ERP

Plataforma ERP/SaaS multiempresa para gestão de assistência técnica e reparo.

**Estado atual: fundação completa + módulos de negócio Clientes, Equipamentos,
Ordens de Serviço com workflow, Orçamentos, Estoque, Compras, Financeiro e
Garantias (Prompts 01 a 13).** Autenticação, sessões,
usuários, perfis, permissões com **escopo por unidade**, multi-tenancy,
modularidade, auditoria, eventos, jobs, Design System, interface responsiva,
**Clientes**, **Equipamentos e Recebimento** (com fotos em storage privado), a
**Ordem de Serviço** (abertura, numeração humana, vínculos, ficha e histórico) e
o seu **workflow** (nove estados, transições validadas, ações, responsável,
follow-ups, tarefas e preparação para entrega) estão implementados e testados.
os **Orçamentos** (itens, valores, envio, aprovação, recusa e revisões), o
**Estoque e Peças** (catálogo, localizações, saldos, ledger append-only,
reservas e transferências) e **Fornecedores e Compras** (cadastro de
fornecedor, necessidades, pedidos, recebimento parcial e histórico de custo) e
o **Financeiro** (contas a receber e a pagar, parcelamento, recebimentos e
pagamentos parciais, estorno controlado, razão append-only e caixa operacional)
estão implementados e testados. As **Garantias** (políticas, garantia interna,
de fábrica, de peça e estendida, cobertura total e parcial, vigência,
certificado com soma de verificação, retorno em garantia com Ordem de Serviço
nova, reclassificação controlada e custos) também. Os demais módulos serão
construídos nos prompts seguintes.

**Estoque, Compras, Financeiro e Garantias são módulos OPCIONAIS**
(`operations.inventory`, `operations.purchasing`, `finance.core`,
`operations.warranties`): a empresa
pode desligá-los. Sem Estoque, o Orçamento continua inteiro com linha de peça
escrita à mão ([modularidade do Estoque](docs/modules/inventory/modularity.md));
sem Compras, o Estoque não percebe diferença nenhuma e a origem
"Compra PC 000037" continua legível no ledger
([modularidade de Compras](docs/modules/purchasing/modularity.md)); sem
Financeiro, a OS, o pedido de compra, o cliente e o fornecedor continuam
inteiros — receber mercadoria nunca dependeu de haver financeiro
([modularidade do Financeiro](docs/modules/finance/modularity.md)); sem
Garantias, a ficha da Ordem de Serviço e a do equipamento ficam exatamente como
eram antes do Prompt 13, e **nenhuma consulta é feita**
([modularidade de Garantias](docs/modules/warranties/modularity.md)).

**O Financeiro não fala com banco nenhum.** Não há conciliação bancária, não há
PIX automático, não há integração com adquirente e não há emissão fiscal.
"Cartão em 3x" é o registro do que foi combinado na maquininha. Não se calcula
lucro, margem nem DRE, e não há score, limite ou bloqueio de cliente: o sistema
mostra a situação, quem decide é a pessoa no balcão
([o que ficou para depois](docs/modules/finance/future.md)).

A cobrança de uma Ordem de Serviço **nasce de um ato humano** na própria ficha,
com o valor pré-preenchido do orçamento aprovado — não da aprovação do
orçamento. Quando todos os recebíveis de uma OS são quitados, o Financeiro
publica `SERVICE_ORDER_FINANCIAL_SETTLED`, e **esse evento continua sem
consumidor**. O Prompt 13 decidiu deliberadamente não consumi-lo: a garantia
interna começa quando o cliente **retira** o aparelho, não quando paga — quem
paga por PIX na terça e retira na sexta não pode perder três dias de cobertura
([ADR-063](docs/adr/ADR-063-garantia-interna-comeca-na-entrega.md)).

**O retorno em garantia cria uma Ordem de Serviço NOVA.** A original nunca
reabre e o número dela nunca é reaproveitado: são dois atendimentos, com dois
históricos íntegros
([ADR-065](docs/adr/ADR-065-retorno-cria-os-nova.md)). O certificado é um
snapshot dos termos da emissão, com soma de verificação e um QR que carrega
**apenas um token opaco** — nunca CPF, telefone ou endereço. **Não há geração de
PDF**: o certificado é HTML, e o navegador imprime
([ADR-070](docs/adr/ADR-070-certificado-e-snapshot-com-token-opaco.md)).

**Conserto em garantia válida não gera cobrança.** `warranty_costs` mede o gasto
interno da loja e **não cria** título, movimento no razão nem cobrança
([ADR-071](docs/adr/ADR-071-custo-de-garantia-nao-toca-o-financeiro.md)).

**Nenhuma comunicação externa é enviada.** A ação "Informar Ordem Disponível"
registra a intenção, publica o evento e diz isso em texto na própria tela; não
há WhatsApp nem e-mail integrado (Prompt 16). **Nenhum evento é consumido**: não
há handler, automação nem Rule Engine (Prompt 19).

A **leitura automática de etiqueta** tem contrato, fluxo e testes, mas **não
está operacional**: nenhum provider de OCR foi contratado ou configurado, e o
sistema declara isso na própria interface (ADR-032).

---

## Sumário

1. [Requisitos](#1-requisitos)
2. [Instalação](#2-instalação)
3. [Variáveis de ambiente](#3-variáveis-de-ambiente)
4. [Banco de dados e migrations](#4-banco-de-dados-e-migrations)
5. [Bootstrap do primeiro administrador](#5-bootstrap-do-primeiro-administrador)
6. [Seed de desenvolvimento](#6-seed-de-desenvolvimento)
7. [Desenvolvimento](#7-desenvolvimento)
8. [Testes, lint e typecheck](#8-testes-lint-e-typecheck)
9. [Build e produção](#9-build-e-produção)
10. [Jobs em background](#10-jobs-em-background)
11. [Arquitetura](#11-arquitetura)
12. [Segurança](#12-segurança)
13. [Identidade visual](#13-identidade-visual)
14. [Dívida técnica conhecida](#14-dívida-técnica-conhecida)

---

## 1. Requisitos

| Requisito        | Versão                                |
| ---------------- | ------------------------------------- |
| Node.js          | 22 LTS (`>=22 <23`)                   |
| MariaDB ou MySQL | MariaDB 10.11+ (validado em 10.11.14) |
| npm              | 10+                                   |

A versão do Node está fixada em `engines` e `.nvmrc` — não dependa da versão
que estiver instalada por acaso.

---

## 2. Instalação

```bash
git clone <url-do-repositorio> nexo56-erp
cd nexo56-erp
npm ci
cp .env.example .env.local   # preencha os valores
```

---

## 3. Variáveis de ambiente

Copie `.env.example` para `.env.local` (desenvolvimento) e preencha.
**Nunca versione o `.env` real.**

| Variável                 | Obrigatória | Descrição                                                                                                        |
| ------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `APP_URL`                | sim         | URL pública da aplicação. Em produção precisa ser `https://`                                                     |
| `DATABASE_URL`           | sim         | `mysql://usuario:senha@host:porta/banco`                                                                         |
| `TEST_DATABASE_URL`      | para testes | Banco **dedicado** a testes; os testes truncam tabelas                                                           |
| `SESSION_SECRET`         | sim         | Mínimo 32 caracteres. `openssl rand -base64 48`                                                                  |
| `JOB_SECRET`             | sim         | Mínimo 32 caracteres. `openssl rand -base64 48`                                                                  |
| `SESSION_TTL_HOURS`      | não         | Duração da sessão. Padrão 12                                                                                     |
| `LOG_LEVEL`              | não         | `debug` \| `info` \| `warn` \| `error`. Padrão `info`                                                            |
| `DB_POOL_SIZE`           | não         | Conexões do pool. Padrão 5                                                                                       |
| `STORAGE_ROOT`           | não         | Raiz das fotos de equipamento. Padrão `storage`. **Sempre fora de `public/`**; entre no backup junto com o banco |
| `ALLOW_SEED`             | não         | `true` libera o seed. **Nunca em produção**                                                                      |
| `ALLOW_INSECURE_APP_URL` | não         | Permite `APP_URL` http em build de produção, para verificação local/staging. **Nunca em produção**               |

Não defina `NODE_ENV`: o Next cuida disso, e um valor fixo no `.env` quebra o
build.

As variáveis são **validadas no startup**. Faltando uma crítica, ou com segredo
de exemplo em produção, a aplicação falha com mensagem explícita em vez de
subir silenciosamente insegura.

---

## 4. Banco de dados e migrations

Crie o banco com charset `utf8mb4` e collation `utf8mb4_unicode_ci`:

```sql
CREATE DATABASE nexo56 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Aplique as migrations:

```bash
npm run db:migrate
```

Para gerar uma nova migration depois de alterar o schema:

```bash
npm run db:generate      # gera o SQL em drizzle/
npm run db:migrate       # aplica
```

**Regras** (Prompt 01, itens 47 e 95):

- Toda alteração estrutural tem migration versionada.
- `db push` **não** é usado como substituto de migration.
- Nunca "apagar o banco e começar de novo" para resolver migration.
- As migrations são um passo **explícito** do deploy, nunca automáticas no boot.

### Tabelas

18 no total: `tenants`, `units`, `tenant_sequences`, `users`, `user_units`,
`sessions`, `roles`, `permissions`, `role_permissions`, `user_roles`,
`features`, `feature_dependencies`, `plans`, `plan_entitlements`,
`tenant_features`, `audit_logs`, `domain_events`, `jobs`.

### Documentação do modelo

| Documento                                                   | Conteúdo                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Convenções](docs/database/conventions.md)                  | Nomenclatura, IDs, tempo, dinheiro, nulos, soft delete, FKs, índices, paginação |
| [Schema físico](docs/database/schema.md)                    | Cada tabela: finalidade, ownership, PK, FKs, índices, política de delete        |
| [Data Dictionary](docs/database/data-dictionary.md)         | Significado, tipo e obrigatoriedade das colunas                                 |
| [Matriz de ownership](docs/database/ownership-matrix.md)    | Escopo de cada entidade, existente e futura                                     |
| [Sensibilidade de dados](docs/database/data-sensitivity.md) | Classificação PII, financeiro, credencial                                       |
| [ERD](docs/database/erd.md)                                 | Diagrama Mermaid — schema atual e modelo conceitual futuro                      |
| [Governança e LGPD](docs/database/lgpd.md)                  | Finalidade, minimização, retenção, direitos do titular                          |

---

## 5. Bootstrap do primeiro administrador

```bash
BOOTSTRAP_TENANT_NAME="Minha Assistência" \
BOOTSTRAP_TENANT_SLUG="minha-assistencia" \
BOOTSTRAP_ADMIN_NAME="Nome do Administrador" \
BOOTSTRAP_ADMIN_EMAIL="admin@empresa.com.br" \
npm run bootstrap
```

Opcionais: `BOOTSTRAP_ADMIN_PASSWORD` (mínimo 12 caracteres),
`BOOTSTRAP_TENANT_TIMEZONE` (padrão `America/Sao_Paulo`), `BOOTSTRAP_UNIT_NAME`.

**Não existe credencial fixa.** Sem `BOOTSTRAP_ADMIN_PASSWORD`, uma senha
aleatória é gerada e exibida **uma única vez** no terminal — ela não vai para
log, auditoria nem repositório.

O comando é **idempotente**: se a empresa já existe, nada é recriado nem
sobrescrito.

O que ele faz: sincroniza o catálogo de funcionalidades e permissões, cria o
plano interno, a empresa, a unidade principal, o perfil `admin` com todas as
permissões estruturais e o usuário administrador — tudo com auditoria e eventos.

---

## 6. Seed de desenvolvimento

```bash
ALLOW_SEED=true npm run db:seed
```

Cria uma empresa **claramente fictícia** (`exemplo-dev`,
`admin.dev@exemplo.invalid`) com senha aleatória exibida uma vez.

Proteções: recusa `NODE_ENV=production`, exige `ALLOW_SEED=true`, não apaga nem
reseta banco, não cria senha conhecida.

---

## 7. Desenvolvimento

```bash
npm run dev          # http://localhost:3000
```

Outros comandos:

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
npm run format:check # prettier --check
```

---

## 8. Testes, lint e typecheck

```bash
npm test             # vitest run
npm run test:watch
```

### Banco de teste

Os testes usam **exclusivamente** `TEST_DATABASE_URL` e **se recusam a rodar**
se ela for igual a `DATABASE_URL` ou se `NODE_ENV=production` — o banco de
produção nunca pode ser alcançado por um teste que trunca tabelas.

```sql
CREATE DATABASE nexo56_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

**Privilégio adicional:** o teste de upgrade de migration cria e descarta
bancos temporários com prefixo `nexo56_`. Conceda ao usuário de teste:

```sql
GRANT ALL PRIVILEGES ON `nexo56\_%`.* TO 'seu_usuario'@'localhost';
```

No CI isso já é atendido porque a suíte roda como `root` no serviço MariaDB.

A limpeza entre testes **preserva o schema** (`DELETE`, nunca `DROP DATABASE`).
Se preferir subir o MariaDB de teste em container, isso é uma escolha **local**:
produção não depende de Docker.

### Cobertura da fundação

| Área             | O que é testado                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Senha            | não armazena texto puro, salt por senha, verificação, hash malformado, rehash, equalização de tempo                                         |
| Login            | válido, senha errada, e-mail inexistente com a mesma mensagem, usuário inativo, entrada malformada, rate limit, e-mail em duas empresas     |
| Sessão           | token inexistente, revogação, expiração, só o hash no banco, conta desativada, limpeza idempotente                                          |
| Multi-tenancy    | os 4 cenários obrigatórios do item 22                                                                                                       |
| Effective Access | feature inexistente, bloqueada por plano, desativada pelo tenant, sem permissão, permitida, CORE não desativável, reativação preserva dados |
| Auditoria        | ação gera registro, falha também, nenhum segredo no registro, redação de campos sensíveis, antes/depois                                     |
| Eventos          | despacho após commit, rollback não emite nem chama handler, falha de handler não derruba a operação                                         |
| Jobs             | idempotência pelo UNIQUE, concorrência, handler desconhecido, backoff, recuperação de job travado                                           |

### Cobertura do controle de acesso (Prompt 03)

| Área                 | O que é testado                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Escopo de papel      | TENANT vale nas unidades já acessadas; UNIT vale só na sua unidade e não em ação de nível tenant; composição sem duplicar      |
| Vínculo de unidade   | papel por unidade exige vínculo (inclusive no banco); remover o vínculo remove os papéis daquela unidade, mas não os de tenant |
| Escalonamento        | não concede o que não tem, não amplia o próprio acesso, nem o administrador                                                    |
| Travessia de tenant  | papel, unidade, usuário, sessão e recurso de outra empresa negados — "registro não encontrado", sem confirmar existência       |
| Último administrador | revogar, inativar e esvaziar permissões bloqueados; **inclusive com duas remoções simultâneas**                                |
| Senha                | mínimo, máximo sem truncar, senha óbvia recusada, troca exige a atual, a antiga deixa de valer                                 |
| Redefinição          | só o hash no banco, uso único, expiração, novo token invalida o anterior, conclui revogando todas as sessões                   |
| Sessões              | lista e identifica a atual, encerra uma ou as outras, revogação administrativa, nunca devolve o hash                           |
| Administração        | senha inicial aleatória, tenant vem do contexto, e-mail normalizado, inativar encerra sessões, evento só após o commit         |
| Perfis de origem     | Administrador com todas as permissões; Atendente/Técnico/Financeiro sem permissões, editáveis                                  |

### Cobertura do Estoque (Prompt 10)

| Área              | O que é testado                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quantidade exata  | `DECIMAL(14,4)` sem float, `0.1 + 0.2 = 0.3`, half-up na quinta casa, unidade integral recusa fração                                                     |
| Saldo             | `available = on_hand − reserved`; reserva consome o disponível e **não** o físico; as três invariantes                                                   |
| Ledger            | quantidade com sinal, saldo resultante, append-only, reconciliação contra o materializado                                                                |
| Custo             | média ponderada determinística, entrada sem custo não derruba a média, arredondamento uma vez no produto                                                 |
| **Concorrência**  | **duas saídas, duas reservas, reserva × saída, dois consumos e duas transferências disputando o mesmo saldo — em paralelo, no banco de verdade**         |
| Idempotência      | retry e duplo clique **simultâneo** de entrada, transferência e consumo produzem um lançamento só                                                        |
| Estoque negativo  | recusado pelo `WHERE`, pelo domínio **e** pela CHECK constraint (tentativa por SQL direto)                                                               |
| Cross-tenant      | catálogo, saldo, movimento, reserva, transferência e vínculo com orçamento — inclusive por `INSERT` direto no banco                                      |
| Cross-unit        | OS da unidade A não consome estoque da B; prateleira de outra unidade recusada — FK composta provada por SQL direto                                      |
| Orçamento         | linha PART manual continua válida; vínculo opcional funciona; peça alterada **não** muda proposta aprovada; salvar/enviar/aprovar **não** movimenta nada |
| Workflow boundary | teste arquitetural sobre `src/`: estoque não escreve `service_orders.status` nem chama o workflow; ledger não recebe `UPDATE`/`DELETE`                   |
| Modularidade      | desativar não apaga nada, bloqueia operação nova e mantém o orçamento funcionando com linha manual                                                       |
| Estoque mínimo    | alerta sai uma vez por queda; volta a ser possível quando o estoque se recupera; mínimo zero nunca alerta                                                |

### Cobertura de Garantias (Prompt 13)

| Área             | O que é testado                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vigência         | fim **inclusivo**; `addMonths` trunca 31/01 + 1 mês corretamente; classe temporal calculada no fuso da **empresa**, nunca no do navegador                  |
| Acionável        | ativa **E** vigente; revogada dentro do prazo não vale; ativa e vencida não vale; a recusa vem com a frase que explica                                     |
| Cobertura        | parcial recusa defeito fora da lista mesmo no prazo; `undetermined` não cria OS; a regra que decide a OS exige tipo interno + acionável + coberta          |
| Snapshot         | mudar a política **não** altera garantia emitida nem certificado; o serviço de certificado **não importa** `warranty_policies` (varredura do código-fonte) |
| Emissão          | exige OS `completed`; duplo clique com a mesma chave devolve a mesma garantia; numeração atômica sem `MAX+1`                                               |
| Retorno          | cria OS **nova** em `awaiting_repair`, na mesma transação; a original não reabre nem tem o número reaproveitado; retorno recusado é registrado assim mesmo |
| Estado inicial   | `status`, `classification` e `origin` passados pelo formulário público são descartados — a OS nasce em `awaiting_technical_opinion`                        |
| **Concorrência** | **duas e cinco emissões simultâneas com a mesma chave; dois retornos simultâneos — em paralelo, no banco de verdade**                                      |
| Reclassificação  | exige permissão própria e motivo de 15+ caracteres; passa pela máquina de estados; **não** aparece no seletor genérico de status                           |
| Certificado      | gerar de novo devolve o mesmo token; o token não contém o número da garantia, não é derivável dele, tem entropia e nunca colide                            |
| Boundary         | teste arquitetural sobre `src/`: Garantias não escreve `service_orders.status`, `stock_balances`, `stock_movements`, `stock_reservations` nem o Financeiro |
| Autorização      | dez permissões verificadas na unidade **da garantia**; custo exige chave própria; garantia de outra empresa responde "não encontrado"                      |
| Modularidade     | com a feature desligada, a ficha da OS e a do equipamento ficam idênticas ao que eram — e **nenhuma consulta é feita**                                     |
| Migration        | upgrade real de um banco no estado do Prompt 12 para o 13, com dados preexistentes preservados                                                             |
| Interface        | a recusa é dita, não escondida; nenhuma tela menciona WhatsApp, SMS, PDF, nota fiscal ou compra de peça (varredura do texto renderizado)                   |

---

## 9. Build e produção

```bash
npm run build        # build de produção
npm start            # next start
```

Deploy na Hostinger: **[docs/hostinger.md](docs/hostinger.md)**.

### Health check

```
GET /api/health                 → {"status":"ok"}
GET /api/health?check=ready     → inclui o banco
```

Nenhum dos dois expõe versão, host, credencial ou detalhe interno.

---

## 10. Jobs em background

```bash
npm run jobs:run
```

O domínio **não conhece cron**: a regra de negócio enfileira um job; quem o
executa é substituível (cron hoje, worker ou fila depois) sem reescrever nada.

Detalhes, cron do hPanel e idempotência:
[docs/architecture/events-jobs-audit.md](docs/architecture/events-jobs-audit.md).

---

## 11. Arquitetura

Monólito modular, organizado por domínio:

```
src/
  app/            páginas, Server Actions, shell
  design-system/  componentes e tokens
  modules/<m>/    domain · application · infrastructure
  core/           config, db, errors, logging, ids, context, rate-limit
scripts/          migrate, bootstrap, seed, run-jobs
drizzle/          migrations versionadas
docs/             arquitetura, ADRs, Hostinger
```

- **Visão geral:** [docs/architecture/README.md](docs/architecture/README.md)
- **Decisões (ADRs):** [docs/adr/README.md](docs/adr/README.md)
- **Autenticação e sessões:** [docs/architecture/auth.md](docs/architecture/auth.md)
- **Papéis, permissões e escopo por unidade:** [docs/architecture/access-control.md](docs/architecture/access-control.md)
- **Matriz de acesso:** [docs/architecture/access-matrix.md](docs/architecture/access-matrix.md)
- **Design System:** [docs/design-system/overview.md](docs/design-system/overview.md)
- **Clientes:** [docs/modules/customers/overview.md](docs/modules/customers/overview.md)
- **Equipamentos e Recebimento:** [docs/modules/equipment/overview.md](docs/modules/equipment/overview.md)
- **Ordens de Serviço:** [docs/modules/service-orders/overview.md](docs/modules/service-orders/overview.md)
- **Orçamentos:** [docs/modules/quotes/overview.md](docs/modules/quotes/overview.md)
- **Estoque e Peças:** [docs/modules/inventory/overview.md](docs/modules/inventory/overview.md)
- **Fornecedores e Compras:** [docs/modules/purchasing/overview.md](docs/modules/purchasing/overview.md)
- **Financeiro:** [docs/modules/finance/overview.md](docs/modules/finance/overview.md)
- **Garantias:** [docs/modules/warranties/overview.md](docs/modules/warranties/overview.md)

---

## 12. Segurança

Resumo e **limitações conhecidas**:
[docs/architecture/security.md](docs/architecture/security.md).

Pontos centrais:

- Senha com scrypt (`N=2^16, r=8, p=2`), sem dependência nativa.
- Sessão server-side com token opaco; o banco guarda só o SHA-256.
- Isolamento de tenant garantido no backend **e no banco** (FKs compostas).
- Autorização com **negação por padrão**, num único serviço, revalidada no
  servidor em toda página e ação.
- **Nenhum superusuário embutido**: o Administrador é um papel com permissões.
- Ninguém concede permissão que não tem, nem amplia o próprio acesso.
- A empresa nunca fica sem administrador.
- Segredos nunca em log nem em auditoria.
- Mídia fora de `public/`, com chave opaca gerada pelo servidor e entrega por
  rota autenticada; mídia de outro tenant responde 404.
- Ordem de Serviço é da unidade: quem opera outra loja não a vê nem com o UUID.
- O estado da OS muda por **uma porta só**, com a matriz de transições num
  arquivo — e a permissão é avaliada na unidade **da ordem**, não na ativa.
- Duas pessoas gravando a mesma OS ao mesmo tempo: só uma vence, e a outra é
  avisada — nunca sobrescrita em silêncio.
- Numeração humana única por empresa, alocada atomicamente e testada com
  aberturas simultâneas.
- Imagem validada por **magic bytes**, não por extensão nem `Content-Type`.
- Foto reexportada no navegador antes do upload: o EXIF (inclusive GPS) não
  acompanha.
- O frontend **nunca** é barreira de segurança.

---

## 13. Identidade visual

Sora (600/700) em títulos; Inter (400/500/600) em interface. Paleta
institucional `#0066FF`, `#101828`, `#FFFFFF`, `#F2F4F7`, centralizada em
tokens. Documentação completa em
[docs/design-system/](docs/design-system/overview.md).

**Os ativos oficiais de logo e ícones ainda não foram fornecidos.** A logo não
é reconstruída com fonte; enquanto isso a aplicação exibe um marcador neutro —
inclusive o favicon, que é um quadrado mudo na cor institucional, sem letra nem
símbolo. Instruções: [public/brand/README.md](public/brand/README.md).

### Vitrine do Design System

```bash
npm run dev   # http://localhost:3000/design-system
```

Referência viva de todos os componentes e estados. **Responde 404 em
produção** — não é tela de produto — e não lê nem grava dado algum.

---

## 14. Dívida técnica conhecida

| Item                                             | Detalhe                                                                                                                                                                                  | Caminho                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| ESLint na linha 9.x                              | O `eslint-plugin-react` do `eslint-config-next@16` ainda não roda em ESLint 10                                                                                                           | atualizar quando o preset suportar                                                          |
| 4 vulnerabilidades moderadas de dev              | Cadeia `drizzle-kit → @esbuild-kit → esbuild`; afetam apenas o servidor de desenvolvimento, não o runtime de produção                                                                    | aguardar atualização do drizzle-kit                                                         |
| CSP com `'unsafe-inline'` em `script-src`        | O runtime do Next injeta scripts inline sem nonce em `next start`                                                                                                                        | CSP por nonce via middleware                                                                |
| Rate limit por processo                          | Store em memória; conta por instância                                                                                                                                                    | implementar `RateLimitStore` com Redis                                                      |
| Sem worker de outbox                             | Eventos são despachados em processo; a tabela já tem formato de outbox                                                                                                                   | worker lendo `published_at IS NULL`                                                         |
| Build depende de rede para as fontes             | `next/font/google` baixa Sora e Inter no build                                                                                                                                           | versionar WOFF2 se houver build offline                                                     |
| Sem 2FA                                          | Não há segundo fator; o pipeline de autorização comporta a condição adicional sem reconstrução                                                                                           | prompt futuro de segurança                                                                  |
| Sem autoatendimento de redefinição               | Nenhum serviço de e-mail configurado; o código é gerado por um administrador e entregue pessoalmente                                                                                     | configurar canal de e-mail                                                                  |
| Rate limit só no login                           | Troca de senha e ações administrativas não têm limite próprio                                                                                                                            | estender quando houver store compartilhado                                                  |
| Leitura de etiqueta sem provider                 | Contrato, normalização e fluxo prontos; nenhum fornecedor de OCR contratado ou configurado — a interface declara isso                                                                    | implementar um `EquipmentLabelRecognitionProvider` e habilitar `platform.label_recognition` |
| Código de barras não decodificado                | O campo existe no contrato; não há decoder embarcado                                                                                                                                     | avaliar decoder no navegador ou no provider                                                 |
| HEIC depende do navegador                        | O servidor recusa HEIC com explicação; a conversão depende de o navegador decodificar o arquivo. Não validado com arquivo HEIC real                                                      | testar em iOS/Safari com aparelho                                                           |
| Câmera física não exercitada em teste            | O navegador dos testes não tem câmera; só o caminho de arquivo é executado, com o mesmo código de preparo                                                                                | validação manual em aparelho                                                                |
| Backup em duas partes                            | Banco e `STORAGE_ROOT` precisam ser copiados juntos, ou as fotos ficam órfãs                                                                                                             | rotina única de backup                                                                      |
| Anonimização não remove mídia                    | A rotina de anonimização (ainda inexistente) terá de apagar arquivos do storage, não só limpar colunas                                                                                   | prompt de LGPD                                                                              |
| Etiqueta física não imprimível                   | O contrato de dados existe e é testado. O Prompt 13 trouxe a classificação de garantia e o formato do token opaco do certificado; o QR **da OS** e a impressão em si continuam pendentes | prompt futuro de documentos                                                                 |
| QR da OS não implementado                        | Princípios fixados (referência opaca; QR identifica mas não autoriza); formato do token e ciclo de vida ainda não decididos                                                              | prompt futuro                                                                               |
| Ninguém é notificado de follow-up vencido        | O job publica `SERVICE_ORDER_FOLLOW_UP_OVERDUE`; **não há canal de comunicação nem central de notificação interna**. As pendências aparecem na tela, por consulta                        | Prompt 16 (comunicação) + prompt de notificação interna                                     |
| "Informar Ordem Disponível" não envia nada       | Registra a intenção, muda o estado e publica evento com `delivered: false`. A interface declara isso                                                                                     | Prompt 16                                                                                   |
| Eventos de workflow sem consumidor               | Seis tipos publicados no outbox, nenhum handler                                                                                                                                          | Prompt 19 (automações)                                                                      |
| "Buscar Peça" guarda texto livre                 | O Prompt 10 trouxe o catálogo de peças, mas **manteve a tarefa como é** (item 48): buscar peça é trabalho, dar entrada é estoque. Fornecedor e local de retirada continuam sem entidade  | Prompt 11                                                                                   |
| Follow-up em dias corridos                       | A regra fixa +2 e +3 e não menciona dias úteis; não há calendário de feriados                                                                                                            | decisão de negócio (ADR-039)                                                                |
| Orçamento sem PDF                                | Não há infraestrutura documental nem ativos de marca; os dados e a imutabilidade pós-envio já estão prontos para quando houver                                                           | prompt futuro de documentos                                                                 |
| Aprovação de orçamento é interna                 | Registrada pela equipe depois de falar com o cliente; a origem gravada é `internal` e a ficha declara isso                                                                               | Prompt 17 (Portal)                                                                          |
| Desconto de orçamento só em valor                | Percentual exigiria coluna de tipo e decisão sobre arredondamento; o item 39 pede não-ambiguidade                                                                                        | decisão de negócio                                                                          |
| Orçamento complementar após aprovação            | Exigiria transição `Aguardando Conserto → Aguardando Aprovação`, que não existe na matriz do Prompt 08                                                                                   | decisão de negócio                                                                          |
| Linha de peça pode citar o catálogo              | `quote_items.part_id` é aditiva e **anulável**; escolher a peça não reserva nem movimenta nada, e o orçamento continua sendo snapshot comercial (ADR-047)                                | —                                                                                           |
| Transferência de estoque é imediata              | Não há estado `in_transit`: o sistema não acompanha o transporte, e fingir que acompanha deixaria saldo preso para sempre (ADR-046)                                                      | quando houver conferência no destino                                                        |
| Estoque baixo não notifica ninguém               | O job marca o saldo e publica `LOW_STOCK_DETECTED`; **não há canal de comunicação nem pedido de compra automático**                                                                      | Prompt 11 (compras) + Prompt 16 (comunicação)                                               |
| Sem leitor de código de barras                   | A coluna, a normalização e a busca existem; o scanner de câmera, não. A tela do cadastro declara isso                                                                                    | prompt futuro                                                                               |
| Sem contagem de inventário                       | O ajuste com motivo obrigatório cobre a correção pós-contagem; um módulo de inventário cíclico seria arquitetura sem requisito (item 57)                                                 | decisão de negócio                                                                          |
| Sem lote, validade e série de peça               | Nem toda peça tem; impor faria o cadastro de um parafuso pedir número de série. A arquitetura aceita a extensão de forma aditiva                                                         | decisão de negócio                                                                          |
| Sem FIFO/LIFO                                    | Média ponderada móvel, determinística e testada. Valuation contábil é requisito que ninguém pediu (item 71)                                                                              | Prompt 12 (financeiro), se houver requisito                                                 |
| Sem compatibilidade peça × equipamento           | Nada no sistema afirma que uma peça serve num aparelho (item 113)                                                                                                                        | Prompt 21 (Nexo56 AI)                                                                       |
| Financeiro não fala com banco                    | Sem conciliação bancária, sem OFX, sem PIX automático, sem integração com adquirente. "Cartão em 3x" é registro do combinado na maquininha                                               | prompt futuro de integrações                                                                |
| Sem juros, multa ou desconto na baixa            | Calcular juros sem a política da empresa cadastrada seria inventar número; desconto na liquidação muda o valor devido e exige autorização própria                                        | decisão de negócio                                                                          |
| Sem DRE, margem ou lucro                         | Receita menos algumas despesas não é lucro, e um KPI sem fonte da verdade engana quem decide com ele                                                                                     | prompt futuro de BI                                                                         |
| Sem score, limite ou bloqueio de cliente         | O sistema mostra o que está em aberto e o que venceu; quem decide atender é a pessoa no balcão                                                                                           | decisão de negócio                                                                          |
| Extrato de conta não pagina                      | `listAccountMovements` devolve no máximo 200 linhas. Basta para o extrato do caixa do dia, não para o histórico de um ano                                                                | paginação por cursor, quando houver uso                                                     |
| `SERVICE_ORDER_FINANCIAL_SETTLED` sem consumidor | Emitido quando todos os recebíveis de uma OS são quitados; **nenhum handler o escuta** — é o gancho preparado para Garantias                                                             | Prompt 13 (Garantias)                                                                       |
| Financeiro sem relatório exportável              | Não há CSV nem PDF; as telas respondem as perguntas do balcão, não a análise contábil                                                                                                    | prompt futuro de documentos/BI                                                              |
| Certificado de garantia sem PDF                  | É HTML com snapshot e soma de verificação; o navegador imprime. `format` é coluna e o snapshot é determinístico, então um provider futuro lê o mesmo documento e grava `format = 'pdf'`  | prompt futuro de documentos                                                                 |
| Garantia de fábrica não aciona o fabricante      | `manufacturer`, `external_reference` e `supplier_id` guardam a quem recorrer; abrir chamado é trabalho humano                                                                            | prompt futuro de integrações                                                                |
| Retorno em garantia não avisa o cliente          | O evento é publicado e nenhum handler o consome; a tela diz, em texto, que avisar continua sendo ato humano                                                                              | Prompt 16 (comunicação)                                                                     |
| Custo de garantia sem visão por período          | `sumWarrantyCosts` soma no banco e nenhuma tela o consome. Não há DRE, margem nem "índice de qualidade" — número com nome errado é pior que número nenhum                                | prompt futuro de BI, com a definição escrita antes do número                                |
| Garantia estendida é só registro                 | O tipo `extended` existe e funciona; não há contrato, cobrança nem renovação                                                                                                             | decisão de negócio                                                                          |
