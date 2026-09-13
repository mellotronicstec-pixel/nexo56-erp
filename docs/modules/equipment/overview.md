# Equipamentos e Recebimento

Cadastro dos aparelhos atendidos e registro de cada entrada deles na
assistência. É a base física sobre a qual a Ordem de Serviço (Prompt 07) será
construída: a OS dirá **o que será feito**; este módulo diz **o que é o
aparelho** e **em que estado ele chegou**.

Decisões: [ADR-029](../../adr/ADR-029-equipamento-tenant-recebimento-unidade.md),
[ADR-030](../../adr/ADR-030-armazenamento-de-arquivos.md),
[ADR-031](../../adr/ADR-031-processamento-de-imagem-no-navegador.md),
[ADR-032](../../adr/ADR-032-provider-de-leitura-de-etiqueta.md).

## Índice

- [Modelo de dados](model.md)
- [Fotos e armazenamento](media.md)
- [Leitura de etiqueta](label-recognition.md)
- [Permissões, auditoria e eventos](access.md)
- [12 perguntas de modularidade](modularity.md)

## A decisão que define o módulo

**O equipamento pertence ao TENANT. O recebimento pertence à UNIDADE.**

```
Tenant ──< Cliente ──< Equipamento          (atravessa lojas e anos)
                            │
                            └──< Recebimento >── Unidade   (aconteceu ali, naquele dia)
                                      │
                                      ├──< Acessórios
                                      ├──< Condições físicas
                                      └──< Fotos
```

O mesmo televisor pode ser entregue na loja Centro hoje e na loja Norte no ano
que vem. Se o equipamento fosse da unidade, o atendente da segunda loja não
acharia o cadastro, criaria outro, e o histórico do aparelho — justamente o que
a assistência consulta — nasceria partido.

O recebimento é o oposto: ele **aconteceu num lugar e numa hora**. Quem opera a
loja Norte não precisa ver a fila de bancada da loja Centro. `unit_id` é
obrigatório em `equipment_intakes` e nunca vem do formulário: sai de
`context.activeUnitId`, e um contexto sem unidade ativa recusa o recebimento.

`equipment.origin_unit_id` guarda onde o cadastro nasceu. É **procedência
auditável**, nunca filtro — usar a unidade de origem para restringir acesso
recriaria por acidente o isolamento que este modelo recusa. Coberto por teste de
regressão (`equipment.test.ts`, bloco MULTIUNIDADE, e pelo E2E de troca de
unidade).

## O que o módulo faz

| Capacidade                                                | Estado                                |
| --------------------------------------------------------- | ------------------------------------- |
| Cadastro de equipamento ligado a um cliente               | implementado                          |
| Número de série **opcional**                              | implementado                          |
| Busca por série, marca, modelo e tipo                     | implementado                          |
| Registro de recebimento com data, unidade e atendente     | implementado                          |
| Acessórios entregues junto (lista sugerida + texto livre) | implementado                          |
| Checklist de condições físicas + relato livre             | implementado                          |
| Fotos com preparo no navegador e entrega autenticada      | implementado                          |
| Histórico de recebimentos por equipamento                 | implementado                          |
| Contrato e fluxo de leitura automática de etiqueta        | implementado                          |
| **Leitura automática de etiqueta funcionando**            | **não — não há provider configurado** |
| Decodificação de código de barras                         | não implementado                      |
| Ordem de Serviço, orçamento, garantia                     | fora do escopo (Prompt 07+)           |

## O que o módulo deliberadamente não faz

- **Não diagnostica.** A inspeção de entrada registra o que se vê por fora:
  riscos, amassados, tela trincada, ausência de tampa. A interface diz isso em
  texto (`Isto não é diagnóstico técnico`). Diagnóstico é trabalho da OS.
- **Não impõe unicidade de número de série.** Fabricantes reaproveitam
  formatos, etiquetas são arrancadas e o mesmo número aparece em lotes
  diferentes. Recusar um cadastro por série repetida travaria o atendimento.
- **Não transfere equipamento entre clientes.** `updateEquipment` recusa a troca
  de `customer_id`: o histórico de um aparelho é do dono que o entregou.
- **Não altera a foto quando o cadastro é corrigido.** A foto é prova de como o
  aparelho estava naquele dia; prova que se reescreve sozinha não é prova.

## Fluxo real de atendimento

1. Busca do cliente (módulo Clientes) ou cadastro rápido.
2. **Equipamento**: tipo é o único campo obrigatório. Marca, modelo, série e
   tensão entram quando existem.
3. **Recebimento**: a unidade ativa aparece na tela, não é escolhida no
   formulário. Data/hora, atendente, cabo de força.
4. **Acessórios**: sugestões (controle remoto, cabo, fonte, bolsa, carregador…)
   com quantidade inteira, mais qualquer item digitado.
5. **Inspeção física**: marcação de condições do catálogo, cada uma com
   observação opcional, mais um relato livre.
6. **Fotos**: `Tirar foto` (sugere a câmera traseira) ou `Escolher arquivo`. A
   imagem é reduzida e reexportada no navegador antes de subir.
7. **Ficha do equipamento**: identificação, tensão, fotos e a linha do tempo dos
   recebimentos, cada um com a unidade onde ocorreu.

Esse fluxo foi percorrido de ponta a ponta em navegador real contra o build de
produção (55 verificações automatizadas). O que **não** foi exercitado é
câmera física: o navegador do teste não tem uma. O caminho de arquivo cobre o
mesmo código de preparo.

## Mobile

O atendimento acontece no balcão, muitas vezes num celular. O que isso mudou:

- `capture="environment"` no input de foto sugere a câmera traseira; se não
  houver câmera, ou se ela for negada, `Escolher arquivo` continua inteiro —
  **não existe beco sem saída**.
- A imagem é preparada no dispositivo: menos dado trafegado numa conexão de loja.
- Listas viram cartões abaixo de 768px (o mesmo padrão do Prompt 04); sem
  rolagem horizontal em 360, 390, 768, 1024, 1280, 1440 e 1920px, verificado.
- Alvos de toque de 44px nos controles de foto e do checklist.

Validado redimensionando um navegador real e conferindo layout, rolagem e
acessibilidade em cada largura. **Não** foi validado em aparelho físico nem em
iOS/Safari.

## Integração futura com Ordem de Serviço

O que o Prompt 07 vai encontrar pronto:

- `equipment.id` estável e do tenant — a OS referencia o aparelho, não uma cópia.
- `equipment_intakes.id` com unidade e momento — a OS nasce **de** um
  recebimento e herda dele a unidade, sem inventar uma nova.
- Estado físico de entrada já registrado e imutável: o que a OS discutir depois
  não apaga o que foi visto na entrada.
- Fotos com `intake_id`, separando "foto da entrada" de "foto do cadastro".
- Eventos `EQUIPMENT_INTAKE_CREATED` e `EQUIPMENT_CREATED` no outbox, para quem
  precisar reagir sem acoplar.

O que **não** existe e a OS terá de trazer: estado/fluxo de atendimento,
orçamento, aprovação, peças, garantia e prazo.
