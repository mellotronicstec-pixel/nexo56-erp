# Permissões de Garantias

Dez chaves, porque são dez atos diferentes — e porque quem consulta a cobertura
não é necessariamente quem assume o compromisso, nem quem vê a margem.

| Chave                        | O que libera                                          |
| ---------------------------- | ----------------------------------------------------- |
| `warranties.view`            | listas, ficha, certificado, retornos                  |
| `warranties.create`          | criar rascunho de garantia                            |
| `warranties.issue`           | **emitir** — o ato que passa a valer contra a loja    |
| `warranties.return.create`   | registrar retorno (e, com isso, criar OS de garantia) |
| `warranties.reclassify`      | dizer que a OS de garantia não é garantia             |
| `warranties.cancel`          | cancelar (vale para trás)                             |
| `warranties.revoke`          | revogar (vale de agora em diante)                     |
| `warranties.costs.view`      | ver quanto a garantia custou à loja                   |
| `warranties.costs.manage`    | lançar custo                                          |
| `warranties.settings.manage` | políticas de garantia                                 |

## Por que criar ≠ emitir

Criar rascunho é trabalho de balcão. **Emitir** é o ato que passa a valer contra
a loja: a partir dele existe um compromisso com prazo e escopo. Separar as
chaves permite que o atendente prepare e o responsável confirme.

## Por que reclassificar tem chave própria

Reclassificar contraria uma decisão anterior da própria loja e tira do cliente
um conserto que ele veio buscar de graça. Exige autoridade técnica.

**A autorização é sempre pela chave**, nunca pelo nome textual do cargo.
"Técnico sênior" é rótulo de organograma; permissão é o que o sistema verifica.

## Por que custo tem chaves próprias

O atendente precisa saber se a cobertura vale. Ele não precisa saber a margem da
loja. `listWarrantyCosts` autoriza por conta própria, e a ficha só consulta
custos quando a pessoa tem a chave.

## Escopo

Toda autorização passa por `authorize(context, { permission, featureKey,
unitId })` com:

- `featureKey: FEATURES.OPERATIONS_WARRANTIES` — feature OPCIONAL;
- `unitId` **da garantia**, não da unidade ativa.

Usar a unidade ativa deixaria alguém com acesso a duas lojas mexer na garantia
da loja B enquanto olha a loja A.

## Risco alto

`warranties.revoke`, `warranties.reclassify` e `warranties.settings.manage`
estão marcadas como alto risco no catálogo: revogar remove um direito do
cliente, reclassificar transforma conserto gratuito em orçamento, e a política
define o padrão que toda emissão futura vai sugerir.

## Na interface

`hasPermission(context, ...)` **esconde** o que a pessoa não pode fazer, em vez
de mostrar cinza. Mas a tela esconder é conveniência: cada caso de uso
reverifica. O que a interface omite, o backend recusa.
