# 12 perguntas de modularidade

Respondidas para as três features que este módulo introduz.

---

## `core.equipment` — Equipamentos

| #   | Pergunta               | Resposta                                                                                                                                                                                                                                                |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Classificação**      | `CORE`. Uma assistência técnica sem cadastro de aparelho não é uma assistência técnica.                                                                                                                                                                 |
| 2   | **Pode desativar?**    | **Não.** `CORE` não é desativável pelo tenant nem pelo plano.                                                                                                                                                                                           |
| 3   | **Dependências**       | `core.customers`. Um equipamento sem dono não existe no domínio.                                                                                                                                                                                        |
| 4   | **Dependentes**        | `core.equipment_intake` e `platform.label_recognition`. A Ordem de Serviço (Prompt 07) dependerá das duas primeiras.                                                                                                                                    |
| 5   | **Dados ao desativar** | Não se aplica (não é desativável). Mesmo assim, o mecanismo de dependências **nunca apaga dado**: desativar Clientes impediria ativações incoerentes, e não destruiria equipamento.                                                                     |
| 6   | **Frontend**           | `/equipamentos`, `/equipamentos/novo`, `/equipamentos/[id]`, `/equipamentos/[id]/editar` e a seção **Equipamentos** na ficha do cliente. Cada ponto verifica Effective Access no servidor; a seção da ficha do cliente sequer é renderizada sem acesso. |
| 7   | **Backend/API**        | Server Actions do módulo e a rota autenticada `GET /api/midia/[mediaId]`. Não há API pública.                                                                                                                                                           |
| 8   | **Automações**         | **Nenhuma.** Os eventos (`EQUIPMENT_CREATED`, `EQUIPMENT_UPDATED`) só preparam o futuro Rule Engine.                                                                                                                                                    |
| 9   | **Permissões**         | `equipment.view`, `equipment.manage`.                                                                                                                                                                                                                   |
| 10  | **Plano**              | Entitlement `core.equipment` presente em todo plano — é CORE.                                                                                                                                                                                           |
| 11  | **Reativação**         | Não se aplica. Se um dia fosse possível, o dado estaria intacto: a desativação nunca apaga linha.                                                                                                                                                       |
| 12  | **Histórico**          | O cadastro em si não é histórico (é corrigível, com `before`/`after` na auditoria). O histórico do aparelho vive nos recebimentos, que se acumulam sem sobrescrever.                                                                                    |

---

## `core.equipment_intake` — Recebimento

| #   | Pergunta               | Resposta                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Classificação**      | `CORE`. Receber o aparelho é o ato que inicia o atendimento.                                                                                                                                                                                                                                                               |
| 2   | **Pode desativar?**    | **Não.**                                                                                                                                                                                                                                                                                                                   |
| 3   | **Dependências**       | `core.equipment` (recebe-se o que está cadastrado) e, por transitividade, `core.customers`.                                                                                                                                                                                                                                |
| 4   | **Dependentes**        | A Ordem de Serviço nascerá de um recebimento.                                                                                                                                                                                                                                                                              |
| 5   | **Dados ao desativar** | Não se aplica. Recebimento é **registro histórico**: nem a desativação de uma feature nem a troca de unidade ativa o alteram.                                                                                                                                                                                              |
| 6   | **Frontend**           | `/recebimentos`, `/recebimentos/novo` e o bloco de recebimentos na ficha do equipamento. A unidade aparece na tela como informação, **nunca** como campo escolhível.                                                                                                                                                       |
| 7   | **Backend/API**        | Server Actions do módulo. A mídia do recebimento usa a mesma rota autenticada de equipamento.                                                                                                                                                                                                                              |
| 8   | **Automações**         | **Nenhuma.** `EQUIPMENT_INTAKE_CREATED` e `EQUIPMENT_MEDIA_ADDED` ficam no outbox à espera de quem um dia reaja a eles.                                                                                                                                                                                                    |
| 9   | **Permissões**         | `equipment_intake.view`, `equipment_intake.create`, `equipment_intake.manage_media` — as **primeiras permissões de escopo de unidade** do sistema. Cadastrar equipamento não implica poder receber, e receber não implica poder editar o cadastro nem gerenciar fotos (há teste para cada uma dessas três independências). |
| 10  | **Plano**              | Entitlement `core.equipment_intake` presente em todo plano — é CORE.                                                                                                                                                                                                                                                       |
| 11  | **Reativação**         | Não se aplica.                                                                                                                                                                                                                                                                                                             |
| 12  | **Histórico**          | **Sim, e imutável.** Cada entrada é uma linha nova; o mesmo aparelho acumula recebimentos e nenhum sobrescreve o anterior. Acessórios, condições e fotos daquele dia ficam presos àquele recebimento — inclusive quando o cadastro do equipamento é corrigido depois.                                                      |

---

## `platform.label_recognition` — Leitura automática de etiqueta

É feature **separada**, e essa separação é a decisão (ADR-032).

| #   | Pergunta               | Resposta                                                                                                                                                                                                       |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Classificação**      | `OPTIONAL`. Depende de provider de OCR/visão contratado e cobrado à parte.                                                                                                                                     |
| 2   | **Pode desativar?**    | **Sim**, e hoje ela está efetivamente indisponível: não há provider configurado. Desativá-la não afeta nada além da sugestão automática.                                                                       |
| 3   | **Dependências**       | `core.equipment`.                                                                                                                                                                                              |
| 4   | **Dependentes**        | Nenhum. Nada no sistema exige que a leitura funcione.                                                                                                                                                          |
| 5   | **Dados ao desativar** | As leituras já registradas (`equipment_label_readings`) **permanecem**, e os equipamentos continuam com os valores confirmados por pessoas — que nunca vieram da leitura como autoridade.                      |
| 6   | **Frontend**           | O componente de captura de etiqueta na tela de cadastro. Sem provider, ele **declara a indisponibilidade em português e não exibe o botão de fotografar a etiqueta**.                                          |
| 7   | **Backend/API**        | `recognizeLabel()` atrás da interface `EquipmentLabelRecognitionProvider`. Sem provider: nenhuma chamada de rede, nenhuma credencial.                                                                          |
| 8   | **Automações**         | **Nenhuma.** `EQUIPMENT_LABEL_CONFIRMED` registra a confirmação humana, não dispara nada.                                                                                                                      |
| 9   | **Permissões**         | Nenhuma própria. Usa `equipment.manage` (quem cadastra é quem confirma a sugestão).                                                                                                                            |
| 10  | **Plano**              | Entitlement `platform.label_recognition` — pode existir em uns planos e não em outros. Mesmo contemplada pelo plano, ela só funciona se houver provider configurado: **entitlement não substitui integração**. |
| 11  | **Reativação**         | Imediata e sem migração: ligar o provider e habilitar a feature. O botão aparece porque `isAvailable()` responde `true` — não porque alguém escreveu isso na tela.                                             |
| 12  | **Histórico**          | `equipment_label_readings` guarda provider, status, campos sugeridos com confiança e quem confirmou. Isso permitirá comparar sugerido × corrigido e medir a qualidade do provider sem adivinhar.               |

---

## Dependência de Clientes (item 74)

O mecanismo formal de dependências (`feature_dependencies`, declarado em
`FEATURE_CATALOG`) é o único usado — não há verificação de plano espalhada pelo
módulo.

Ele impede **ativação incoerente**: não se ativa Equipamentos onde Clientes não
está disponível. Ele **não** destrói dado: desativar Clientes não apaga
equipamento algum. E `ON DELETE RESTRICT` na FK composta garante, no banco, que
um cliente com aparelho registrado não desapareça por acidente.
