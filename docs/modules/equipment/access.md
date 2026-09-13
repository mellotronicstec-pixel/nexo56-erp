# Permissões, auditoria e eventos

## Features

| Chave                        | Tipo         | Depende de       | Papel                              |
| ---------------------------- | ------------ | ---------------- | ---------------------------------- |
| `core.equipment`             | CORE         | `core.customers` | cadastro dos aparelhos             |
| `core.equipment_intake`      | CORE         | `core.equipment` | entrada do aparelho na assistência |
| `platform.label_recognition` | **OPTIONAL** | `core.equipment` | leitura automática de etiqueta     |

`core.equipment` depende de Clientes porque **um equipamento sem dono não existe
no domínio**. A dependência impede a _ativação_ incoerente; desativar Clientes
não apaga equipamento — o dado permanece.

`platform.label_recognition` é OPTIONAL de verdade: depende de um provider de
OCR/visão contratado e cobrado à parte. **Todo o módulo funciona sem ela** —
quando indisponível, o cadastro é manual e nada mais muda.

## Permissões

| Chave                           | Nome                           | Feature                 |
| ------------------------------- | ------------------------------ | ----------------------- |
| `equipment.view`                | Visualizar equipamentos        | `core.equipment`        |
| `equipment.manage`              | Administrar equipamentos       | `core.equipment`        |
| `equipment_intake.view`         | Visualizar recebimentos        | `core.equipment_intake` |
| `equipment_intake.create`       | Receber equipamentos           | `core.equipment_intake` |
| `equipment_intake.manage_media` | Gerenciar fotos do recebimento | `core.equipment_intake` |

Ver e receber são permissões separadas de propósito: o balcão registra entrada,
o administrativo consulta a ficha, e nem todo mundo faz as duas coisas.

## Effective Access

Nenhuma tela deste módulo decide sozinha. Cada ponto de entrada passa pelo mesmo
cálculo do Prompt 03:

```
Catálogo de Features × Entitlements do Plano × Configuração do Tenant × Permissões do Usuário
```

- Páginas: `requireAccessForPage(feature, permission)`.
- Server Actions: `requireAuthorization({ permission, featureKey })`.
- Rota de mídia: `can(context, { permission, featureKey })`.
- Seção de Equipamentos na ficha do cliente:
  `checkAccess(context, { featureKey: core.equipment, permission: equipment.view })`
  — a seção **não existe no HTML** quando o módulo não está disponível para
  aquela empresa e aquela pessoa.

Esconder na interface nunca é a proteção: é a consequência dela. A verificação
que vale é a do servidor, e há testes de autorização
(`equipment-authorization.test.ts`) que chamam os services diretamente, sem
passar por tela alguma.

## Tenant × Unidade

|                     | Escopo      | Consequência                              |
| ------------------- | ----------- | ----------------------------------------- |
| `equipment`         | **tenant**  | visível em qualquer unidade da empresa    |
| `equipment_intakes` | **unidade** | só aparece para quem opera aquela unidade |

`unit_id` do recebimento sai de `context.activeUnitId`. **Nunca** do formulário
— não se confia em tenant ou unidade enviados pelo frontend. Contexto sem
unidade ativa recusa o recebimento.

Verificado em três níveis:

1. Integração: consultas com contexto de outra unidade não retornam o
   recebimento, e retornam o equipamento.
2. Banco: FKs compostas recusam cruzar empresa (`ER_NO_REFERENCED_ROW`).
3. E2E: trocando a unidade ativa no navegador, o recebimento some da lista e o
   equipamento continua na ficha.

## Auditoria

Registrada **dentro da mesma transação** da escrita (`recordAudit(…, tx)`): ou os
dois acontecem, ou nenhum.

| Ação                        | Quando                                           |
| --------------------------- | ------------------------------------------------ |
| `equipment.created`         | cadastro de aparelho                             |
| `equipment.updated`         | correção da identificação (com `before`/`after`) |
| `equipment_intake.created`  | entrada registrada                               |
| `equipment_media.added`     | foto anexada                                     |
| `equipment_media.removed`   | foto removida (guarda o que havia)               |
| `equipment_label.confirmed` | humano confirmou uma sugestão de etiqueta        |

## Eventos

Publicados pelo outbox (`runInTransaction(async (tx, emit) => …)`), na mesma
transação:

`EQUIPMENT_CREATED`, `EQUIPMENT_UPDATED`, `EQUIPMENT_INTAKE_CREATED`,
`EQUIPMENT_MEDIA_ADDED`, `EQUIPMENT_LABEL_CONFIRMED`.

São o gancho de que a Ordem de Serviço precisará para reagir a um recebimento
sem que este módulo saiba que a OS existe.

## Segurança — resumo do que é imposto onde

| Risco                                    | Onde é barrado                                   |
| ---------------------------------------- | ------------------------------------------------ |
| Equipamento de cliente de outra empresa  | FK composta no banco                             |
| Recebimento em unidade de outra empresa  | FK composta no banco                             |
| Unidade forjada no formulário            | serviço usa `context.activeUnitId`               |
| Transferência de aparelho entre clientes | `updateEquipment` recusa                         |
| Arquivo executável disfarçado de foto    | magic bytes no servidor                          |
| Path traversal na chave do arquivo       | chave gerada pelo servidor + verificação de raiz |
| Foto acessível por URL adivinhada        | fora de `public/` + rota autenticada             |
| Vazamento de existência de mídia alheia  | `404`, nunca `403`                               |
| Geolocalização embutida na foto          | reexportação no navegador (arquivo novo)         |
| PII em log                               | log de leitura registra só metadados             |
