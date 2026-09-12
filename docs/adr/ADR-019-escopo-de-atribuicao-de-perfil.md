# ADR-019 — Escopo de atribuição de perfil: TENANT × UNIT

**Status:** Aceito · **Data:** Prompt 03

## Contexto

Uma assistência técnica com duas filiais precisa dizer coisas como: "a Ana é
Financeiro na empresa inteira, o Bruno é Técnico **só** na Unidade Norte".

Até o Prompt 02 o Nexo56 só sabia expressar a primeira frase: `user_roles`
concedia o papel no tenant, e `user_units` dizia onde a pessoa podia operar.
Não havia como limitar uma capacidade a uma filial.

Três desenhos foram considerados:

1. **Escopo no perfil** — criar "Técnico Norte" e "Técnico Sul" como perfis
   distintos.
2. **Escopo na atribuição** — o mesmo perfil "Técnico", atribuído com alcance
   de tenant para uma pessoa e de unidade para outra.
3. **Permissão por unidade** — escopo direto na permissão, sem passar pelo
   perfil.

## Decisão

**Escopo na atribuição** (opção 2), em uma tabela nova ao lado da existente:

```
user_roles       → o papel vale no tenant (nas unidades que o usuário acessa)
user_unit_roles  → o papel vale SOMENTE na unidade indicada
```

`user_roles` mantém exatamente a semântica que sempre teve. **Nenhuma linha
existente foi migrada**, e nenhuma instalação muda de comportamento ao subir a
migration.

A composição na hora de autorizar:

- ação **sem** unidade → só os papéis TENANT;
- ação **com** unidade → papéis TENANT mais os papéis UNIT daquela unidade.

## Motivo

O escopo é propriedade da **relação entre pessoa e papel**, não do papel. A
opção 1 força a empresa a duplicar cada perfil por filial: cinco perfis em três
unidades viram quinze objetos para manter em sincronia, e a primeira mudança de
regra esquece um deles. A opção 3 quebra o modelo mental de RBAC — o usuário
configura perfis, não permissões soltas — e multiplicaria a interface por
unidade.

Manter as duas tabelas separadas, em vez de uma coluna `unit_id` anulável em
`user_roles`, tem uma razão prática: com coluna anulável a chave primária
precisaria aceitar `NULL`, o que no MySQL destrói a unicidade (`NULL` nunca é
igual a `NULL`, então a mesma atribuição de tenant poderia ser gravada N vezes).
Com duas tabelas, cada uma tem chave primária honesta e a FK de membership só
existe onde faz sentido.

## Alternativas descartadas

| Alternativa                          | Por que não                                                       |
| ------------------------------------ | ----------------------------------------------------------------- |
| Perfis por unidade ("Técnico Norte") | duplicação combinatória; dessincroniza na primeira mudança        |
| Permissão por unidade, sem perfil    | quebra o modelo de RBAC e a interface de configuração             |
| `unit_id` anulável em `user_roles`   | `NULL` na PK destrói a unicidade no MySQL; migraria linhas vivas  |
| Papel com hierarquia de unidades     | complexidade sem demanda: não há hierarquia de filiais no produto |

## Consequências

- A mesma pessoa pode ter alcances diferentes por papel, sem duplicar perfis.
- Trocar de unidade **muda** as permissões efetivas — comportamento correto, e
  que a interface precisa deixar visível (o seletor de unidade é permanente).
- Duas tabelas de atribuição significam duas consultas no carregamento do
  contexto; são consultas indexadas e paralelas, sem N+1.
- As permissões estruturais desta fase são todas de nível tenant. O motor de
  escopo só passa a ter uso diário quando os módulos de negócio chegarem — está
  implementado e testado antes de ser necessário, de propósito: mudar o modelo
  de autorização depois que existirem ordens de serviço seria muito mais caro.
