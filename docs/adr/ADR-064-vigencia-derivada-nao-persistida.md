# ADR-064 — Vigência é derivada; "expirada" não é coluna

**Status:** Aceito
**Data:** Prompt 13 — Garantias
**Itens atendidos:** 12, 14, 34, 35, 85

## Contexto

`warranty_status` poderia ter seis valores: `draft`, `active`, `expired`,
`cancelled`, `revoked` e talvez `suspended`. É assim que as pessoas falam.

É a mesma armadilha do ADR-055, com um agravante: aqui `expired` não apenas
exigiria um job noturno reescrevendo a carteira — ele **ocuparia o lugar** de
`revoked`. Uma garantia revogada em fevereiro que venceria em março é as duas
coisas, e uma coluna só não comporta isso.

## Decisão

**Duas dimensões independentes, e as duas aparecem na tela.**

- **Situação administrativa** (`warranty_status`, persistida): o que a empresa
  decidiu — `draft`, `active`, `cancelled`, `revoked`.
- **Classe temporal** (`TemporalClass`, derivada): o que o calendário diz —
  `future`, `valid`, `expired`.

"Acionável" é a conjunção das duas, calculada:

```ts
export function isWarrantyEnforceable(snapshot: WarrantySnapshot, referenceDate: string): boolean {
  if (snapshot.status !== 'active') return false;
  return temporalClassOf(snapshot, referenceDate) === 'valid';
}
```

## A data de referência é civil e é da EMPRESA

`starts_on` e `ends_on` são `VARCHAR(10)` ISO (ADR-017), não instantes. A
comparação usa `todayIn(context.tenantTimezone)` — nunca `new Date()` no
navegador. Uma garantia que termina dia 15 termina no dia 15 **da loja**, e não
no dia 15 de quem abriu a tela viajando.

## O último dia conta inteiro

`temporalClassOf` compara com `>`, não com `>=`:

```ts
if (referenceDate > period.endsOn) return 'expired';
```

Um cliente que volta no dia `ends_on` está coberto. A alternativa exclusiva
tiraria um dia de todo mundo, e seria descoberta por reclamação.

## O filtro roda no SQL

`listWarranties` monta a condição temporal com a data de hoje já resolvida no
fuso do tenant, dentro da consulta. Filtrar depois de paginar traria 25 linhas e
mostraria 6.

## Consequências

**Ganhamos:** nenhum job noturno, nenhuma janela de dado velho, e a distinção
entre "venceu" e "foi revogada" — que é a diferença entre um cliente que perdeu
o prazo e um que perdeu o direito.

**Pagamos:** `ends_on` precisa de índice, e todo lugar que decide "vigente"
precisa da data de referência em mãos. As funções do domínio exigem
`referenceDate` como parâmetro obrigatório justamente para que esquecê-lo seja
erro de compilação.
