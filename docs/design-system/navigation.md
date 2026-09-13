# Navegação e shell

## Estrutura

```
≥ 768px                          < 768px
┌────────┬──────────────────┐    ┌──────────────────┐
│ side   │ topbar           │    │ topbar (☰)       │
│ bar    ├──────────────────┤    ├──────────────────┤
│ fixa   │ conteúdo         │    │ conteúdo         │
│ 256px  │                  │    │                  │
└────────┴──────────────────┘    └──────────────────┘
                                  ☰ abre gaveta
```

## Sidebar

Seções (`Minha área`, `Administração`) com ícone, rótulo e item ativo marcado
por `aria-current="page"`.

**A visibilidade sai do Effective Access**, nunca de `isAdmin ? tudo : nada`:
cada item declara `featureKey` e `permission`. Um item só aparece se a feature
existe, o plano permite, a empresa ativou **e** a pessoa tem a permissão no
contexto atual. Módulo indisponível **some** em vez de levar a uma tela que nega.

O menu **não lista módulos inexistentes**. Clientes, Equipamentos, Ordens de
Serviço, Estoque, Compras, Financeiro, Garantias, Agenda, Central de Trabalho,
Comunicação e BI entram aqui cada um no seu prompt, com feature e permissão
próprias. A estrutura de seções já acomoda isso sem reescrita.

### Fronteira servidor/cliente

O layout é Server Component e monta o menu; o shell é Client Component e o
renderiza. Funções **não atravessam** essa fronteira, então o item carrega a
_chave_ do ícone (`'users'`) e o shell resolve o desenho.

Isso foi descoberto em navegador: typecheck e build passavam, e a aplicação
respondia 500 em runtime. Nenhuma verificação estática pega esse erro.

## Topbar

Empresa e unidade ativa à esquerda; seletor de unidade (≥1024px) e menu da
conta à direita. Sem funcionalidade falsa: não há sino de notificações nem
busca global simulada.

## Gaveta mobile

A sidebar **não** é comprimida — vira gaveta, com a navegação completa e o
seletor de unidade. Foco entra ao abrir, circula dentro, Esc fecha e o foco
volta ao botão. Alvos de 44px. Tudo verificado em navegador.

## Seletor de unidade (Prompt 03 — preservado)

| Regra                                    | Estado        |
| ---------------------------------------- | ------------- |
| Mostra a unidade ativa                   | ✅ inalterado |
| Lista **apenas** unidades autorizadas    | ✅ inalterado |
| Troca o contexto pelo servidor           | ✅ inalterado |
| Recalcula permissões após a troca        | ✅ inalterado |
| Funciona no mobile (gaveta)              | ✅ inalterado |
| Não aparece com uma única unidade        | ✅ inalterado |
| Unidade forjada no formulário é ignorada | ✅ inalterado |

O componente ganhou apenas posicionamento (`className`). A Server Action, a
validação e a revalidação de contexto **não foram tocadas**. Regressão coberta
por `tests/integration/role-scope.test.ts`, `multi-unit.test.ts` e pelo E2E.

## Menu da conta

Nome, e-mail, empresa e unidade, resumo dos perfis, "Minha conta", "Senha e
sessões" e "Sair". Só o que existe.

### Um bug real corrigido aqui

O menu fechava ao clique em qualquer item. Isso **desmontava o formulário de
logout no meio do envio**, e "Sair" não fazia nada. Agora o fechamento ignora
cliques dentro de `<form>`: formulários cuidam do próprio fim de vida, porque a
ação navega. Encontrado no E2E — nenhum teste unitário pegaria.

## Trilha de navegação

`Breadcrumb` dentro do `PageHeader`: lista ordenada, último item não é link e
carrega `aria-current="page"`, separadores `aria-hidden`.

## Busca global

**Não implementada.** Existe a primitiva `SearchField` e nada mais: sem motor,
sem índice, sem resultados falsos. `Ctrl+K` também não foi implementado — um
atalho que abre uma busca que não busca é pior do que atalho nenhum.

## Central de notificações

**Não implementada.** A topbar tem espaço previsto; nenhum sino aparece
enquanto não houver notificação real para mostrar.
