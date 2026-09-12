# ADR-021 — Política de autorização: negação por padrão, num ponto só

**Status:** Aceito · **Data:** Prompt 03

## Contexto

Com usuários, perfis, permissões, escopo de unidade e Effective Access, a
decisão "esta pessoa pode fazer isto?" passou a ter seis fatores. Espalhar
esses seis fatores por páginas, Server Actions e serviços produz o pior
resultado possível: cada lugar verifica um subconjunto diferente, e o buraco
aparece exatamente onde ninguém olhou.

O risco concreto é o atalho `if (user.role === 'admin')`. Ele resolve a tela de
hoje e cria um superpoder implícito que nenhuma configuração consegue tirar.

## Decisão

**Um serviço, um pipeline, negação por padrão.** Toda decisão de acesso passa
por `access-control/application/authorization-service.ts`:

```
Autenticado
  AND tenant válido
  AND usuário ativo
  AND sessão válida
  AND unidade autorizada quando a ação é de unidade
  AND permissão concedida NO ESCOPO da ação
  AND feature disponível quando exigida
  AND recurso pertence ao contexto
⇒ PERMITIR — caso contrário NEGAR
```

As quatro primeiras condições já são garantidas pela montagem do
`TenantContext`: sem sessão válida, de usuário ativo, em tenant ativo, o
contexto **não existe**. As demais são avaliadas no serviço.

Regras que acompanham a decisão:

1. **Não existe superusuário.** O Administrador é um papel com todas as
   permissões atribuídas — nada mais. Tirar uma permissão dele tira a
   capacidade de verdade.
2. **A decisão devolve motivo**, não só `true`/`false`, para a interface poder
   explicar em vez de apenas esconder.
3. **Recurso fora do contexto responde "registro não encontrado"**, nunca "sem
   permissão": responder 403 confirmaria que o registro existe.
4. **A interface não é barreira.** Menu e botões consultam `can()` só para UX;
   cada página e cada action revalida no servidor.

## Motivo

Negar por padrão significa que esquecer uma regra produz uma tela inacessível —
um bug visível, que alguém reclama no mesmo dia. Permitir por padrão significa
que esquecer uma regra produz um vazamento silencioso, que ninguém reclama até
virar incidente.

Concentrar num serviço dá dois ganhos que a dispersão nunca dá: a auditoria de
segurança lê **um** arquivo para saber como o produto decide, e acrescentar um
fator novo (um segundo fator de autenticação, por exemplo) é uma mudança em um
lugar só.

## Alternativas descartadas

| Alternativa                               | Por que não                                                         |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Verificação em cada página/action         | subconjuntos diferentes por lugar; o buraco nasce onde ninguém olha |
| Middleware global por padrão de rota      | não conhece o recurso alvo; não resolve IDOR nem escopo de unidade  |
| Flag de superusuário                      | superpoder implícito que a configuração não consegue remover        |
| Permitir por padrão com lista de exceções | esquecer uma regra vaza em silêncio                                 |
| 403 para recurso de outro tenant          | confirma a existência do registro; abre enumeração                  |

## Consequências

- Toda operação nova precisa declarar a permissão que exige — e isso é
  deliberado: a declaração é o registro de qual capacidade ela representa.
- Uma permissão esquecida se manifesta como "acesso negado" para quem deveria
  poder, não como acesso indevido.
- A mensagem "registro não encontrado" para recurso de outro tenant é
  intencionalmente ambígua e pode confundir suporte interno; a trilha de
  auditoria e o log estruturado registram o motivo real.
