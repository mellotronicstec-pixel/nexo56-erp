# Governança de dados e LGPD — Nexo56

Documento inicial exigido pelo Prompt 02, item 44. Descreve a **estratégia**;
o painel de LGPD e as rotinas automatizadas virão em prompt próprio.

> Este documento orienta a engenharia. Não substitui parecer jurídico, e a
> política pública de privacidade do produto é responsabilidade do proprietário.

---

## 1. Papéis

| Papel           | Quem                                                         |
| --------------- | ------------------------------------------------------------ |
| **Titular**     | A pessoa natural: cliente da assistência, usuário do sistema |
| **Controlador** | A empresa cliente (tenant) — define finalidade e meios       |
| **Operador**    | O Nexo56, que trata os dados em nome do controlador          |

Consequência prática: o Nexo56 **não decide sozinho** apagar dado de cliente de
um tenant. Ele oferece os mecanismos; o controlador decide.

---

## 2. Finalidade e base legal

| Dado                                     | Finalidade                                                      | Base legal típica                      |
| ---------------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| Cadastro do cliente                      | Identificar quem entregou o equipamento e a quem devolver       | Execução de contrato                   |
| Contato                                  | Avisar sobre orçamento, conclusão e retirada                    | Execução de contrato                   |
| Endereço                                 | Coleta e entrega, quando houver                                 | Execução de contrato                   |
| CPF/CNPJ                                 | Identificação inequívoca; exigência fiscal                      | Obrigação legal / execução de contrato |
| Equipamento (tipo, marca, modelo, série) | Identificar o aparelho entregue e devolvê-lo ao dono            | Execução de contrato                   |
| Recebimento e estado de entrada          | Provar como o aparelho chegou, protegendo cliente e assistência | Execução de contrato                   |
| Fotos do equipamento                     | Registrar o estado físico na entrada                            | Execução de contrato                   |
| Dados da OS                              | Registro do serviço prestado                                    | Execução de contrato                   |
| Dados financeiros                        | Cobrança e escrituração                                         | Obrigação legal                        |
| Dados do usuário do sistema              | Autenticar e auditar                                            | Legítimo interesse do controlador      |

Comunicação de marketing exigiria **consentimento próprio**, separado do
cadastro — não previsto nesta fase.

---

## 3. Minimização

Aplicada desde a fundação:

- Sessões **não** guardam IP. Do user-agent, só um resumo curto ("Chrome no
  Windows", 120 caracteres) — o suficiente para a pessoa reconhecer o próprio
  dispositivo na lista de sessões, insuficiente para servir de fingerprint ou
  histórico de localização.
- O cadastro de usuário tem o mínimo: nome, e-mail, situação e vínculos.
- O cookie carrega apenas um token opaco.
- **Fotos perdem a geolocalização antes de sair do aparelho**: o preparo no
  navegador reexporta a imagem, e o EXIF não acompanha (ADR-031). A tela orienta
  a fotografar só o equipamento e a etiqueta, evitando pessoas, documentos e o
  ambiente ao redor.
- Log e auditoria passam por redação automática.
- Consulta automática de CPF **não** existe e não será presumida (Prompt 00,
  item 28): conhecer o CPF não autoriza obter dados de terceiros.

---

## 4. Retenção

| Categoria                | Retenção pretendida                                  | Motivo                     |
| ------------------------ | ---------------------------------------------------- | -------------------------- |
| Sessões                  | Expiração + limpeza pelo job                         | Não há valor em manter     |
| Códigos de redefinição   | 60 minutos; consumidos ficam marcados                | Janela mínima de uso       |
| Auditoria                | Longa; definida pelo controlador                     | Prova de conformidade      |
| OS, garantia, financeiro | Enquanto durar a obrigação legal/fiscal e a garantia | Obrigação legal            |
| Cadastro de cliente      | Enquanto houver relação; depois, anonimização        | Minimização                |
| Cadastro de equipamento  | Enquanto houver relação com o cliente                | Histórico do aparelho      |
| Recebimentos e fotos     | Enquanto durar a garantia e a obrigação legal        | Prova do estado de entrada |
| Anexos                   | Junto com a OS que os originou                       | Contexto                   |

**Exclusão não é automática.** Apagar cliente com OS e nota fiscal associadas
conflita com obrigação legal — daí a preferência por **anonimização**.

---

## 5. Direitos do titular

| Direito                           | Estratégia prevista                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Confirmação e acesso              | Exportação por tenant do que se refere ao titular                                                             |
| Correção                          | Edição no cadastro, com auditoria da alteração                                                                |
| Anonimização                      | Substituir campos identificadores preservando o histórico operacional e os números dos documentos             |
| Portabilidade                     | Exportação em formato aberto                                                                                  |
| Eliminação                        | Apenas quando não houver obrigação legal de guarda; caso contrário, anonimização com justificativa registrada |
| Informação sobre compartilhamento | Registro das integrações que receberam dados                                                                  |

**Anonimização preferida à exclusão física** (Prompt 00, item 93): a OS
continua existindo com seu número e seu histórico; o que deixa de existir é o
vínculo com a pessoa identificada.

Para Equipamentos isso tem uma consequência concreta a resolver na rotina de
anonimização: apagar o cliente é impedido pelo banco enquanto houver aparelho
ligado a ele (`ON DELETE RESTRICT`), e a foto do equipamento é um arquivo no
storage — anonimizar o titular exigirá **remover também a mídia**, não só limpar
colunas. Está listado nas pendências.

---

## 6. Acesso e segregação

- Isolamento entre tenants garantido no backend **e no banco** (FKs compostas),
  com testes automatizados.
- RBAC controla quem vê dado pessoal e financeiro, com **escopo por unidade**:
  é possível limitar uma capacidade a uma única filial.
- Vínculo de unidade **não** concede capacidade — quem acessa a filial só vê o
  que o perfil permite.
- Toda leitura de área sensível passa pelo Effective Access e pelo serviço de
  autorização, com negação por padrão.
- O titular vê e encerra as próprias sessões ativas em `/minha-conta`.
- Administração da plataforma **não** implica acesso indiscriminado aos dados
  de cada empresa (Prompt 00, item 105).

---

## 7. Auditoria

`audit_logs` registra tenant, unidade, usuário, ação, entidade, estado anterior
e posterior, origem e correlation ID — somente inserção. É o que permite
responder "quem acessou/alterou o dado deste titular".

---

## 8. Incidentes

Previsto para prompt de segurança/infraestrutura: detecção, registro,
comunicação ao controlador e apoio à comunicação à ANPD quando aplicável.

---

## 9. Pendências assumidas

| Pendência                                    | Quando                                     |
| -------------------------------------------- | ------------------------------------------ |
| Painel de solicitações do titular            | Prompt de Clientes / LGPD                  |
| Rotina de anonimização                       | Depois de Clientes e OS existirem          |
| Remoção de mídia do storage na anonimização  | Junto com a rotina de anonimização         |
| Exportação por titular                       | Idem                                       |
| Política de retenção configurável por tenant | Prompt de SaaS                             |
| Registro de operações de tratamento          | Prompt de segurança                        |
| Cifragem em repouso de campo específico      | Só com ADR; **nunca** criptografia caseira |
