# Compatibilidade

**"Compatibilidade vem antes do preço."** Cinco rótulos oficiais — nenhum
outro existe, e nenhum percentual/nota é mostrado (V1 explicitamente sem
falsa precisão):

| Rótulo                 | Critério                                   | Evidência mínima                                                                    | IA sozinha pode gerar?                                                                            | Seleção permitida?                    | Confirmação humana?                       |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| **Confirmada**         | Fonte autoritativa                         | `manufacturer_part_mapping` OU `internal_verified_mapping`                          | **Não, nunca**                                                                                    | Sim                                   | Sim (seleção é sempre humana)             |
| **Alta Probabilidade** | Evidência forte ou múltiplas consistentes  | `exact_part_number`/`exact_equipment_model`, ou 2+ categorias não-IA distintas      | Não sozinha (nunca ultrapassa sem apoio não-IA)                                                   | Sim                                   | Sim                                       |
| **Provável**           | Evidência indireta/fraca isolada           | um sinal fraco (menção textual, sinal de "serve" do provedor, ou só `ai_inference`) | **Sim — é o teto da IA sozinha**                                                                  | Sim                                   | Sim                                       |
| **Não Verificada**     | Resultado existe, sem evidência suficiente | nenhuma evidência                                                                   | —                                                                                                 | Sim, com confirmação extra consciente | Sim, explícita (`unverifiedAcknowledged`) |
| **Incompatível**       | Contradição explícita                      | `explicit_incompatibility` (veta qualquer outra evidência)                          | Não (IA nunca declara incompatibilidade sozinha nesta V1 — só repassa sinal estruturado da fonte) | **Não — bloqueado**                   | N/A                                       |

## Categorias de evidência (só as que este prompt realmente produz)

`exact_part_number`, `exact_equipment_model`, `manufacturer_part_mapping`,
`internal_verified_mapping`, `provider_exact_fit_signal`,
`title_description_mention`, `explicit_incompatibility`, `ai_inference`.
Cada uma carrega `source`, `type`, `observedAt` e, quando aplicável,
`field`/`value` — proveniência sempre rastreável.

## Política, exata (`domain/compatibility.ts`)

1. `explicit_incompatibility` em qualquer evidência ⇒ **Incompatível**,
   sempre — veta qualquer outra evidência, inclusive autoritativa ou de
   preço baixo (item 44: nada "compensa" uma incompatibilidade declarada).
2. Zero evidência ⇒ **Não Verificada** — não é erro, é honestidade.
3. `manufacturer_part_mapping` OU `internal_verified_mapping` ⇒
   **Confirmada**. São as ÚNICAS duas categorias autoritativas desta V1 —
   deliberadamente SEM `provider_exact_fit_signal` (alegação de
   marketplace nunca é autoridade sozinha) e SEM `ai_inference` (item
   39/175: IA sozinha jamais confirma).
4. Evidência forte (`exact_part_number`/`exact_equipment_model`) OU duas+
   categorias não-IA distintas ⇒ **Alta Probabilidade**.
5. Qualquer evidência restante ⇒ **Provável** — o teto da IA sozinha.

## Por que só duas categorias confirmam

Um marketplace declarar "serve" não é prova (item 113) — é alegação
comercial, sujeita a erro e a incentivo de venda. A única forma honesta de
"Confirmada" nesta V1 é uma fonte que **não tem incentivo comercial**
(mapeamento do fabricante) ou um fato **já verificado dentro do próprio
Nexo56** (uso anterior confirmado, nunca por coincidência de nome — item
114). Como nenhum provedor real está configurado nesta V1 (ver
`providers.md`), `manufacturer_part_mapping` e `internal_verified_mapping`
não são produzidos automaticamente hoje — a política existe pronta para
quando uma fonte assim existir, sem exigir mudança de arquitetura.

## Explicabilidade

Cada candidate devolve `evidenceSummary` — texto curto, factual, uma
linha por categoria de evidência distinta ("Código da peça bate
exatamente", "Fonte declara compatibilidade com este modelo exato") —
nunca o raciocínio interno de um modelo de IA (item 86/87). Quando
`Incompatível`, `blockingReasons` mostra exatamente qual evidência vetou.
