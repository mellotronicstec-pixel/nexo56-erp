# Cores

## Institucionais (Prompt 00, item 81)

| Cor           | Hex       | Papel                                       |
| ------------- | --------- | ------------------------------------------- |
| Azul primário | `#0066FF` | ação, foco, estado ativo, identidade        |
| Azul escuro   | `#101828` | texto principal e superfície invertida      |
| Branco        | `#FFFFFF` | superfície elevada (cartão, tabela, topbar) |
| Cinza claro   | `#F2F4F7` | fundo de página e superfícies rebaixadas    |

Delas saem duas escalas: `brand-50…900` e `ink-25…900`. Nenhuma cor decorativa
foi criada fora disso.

## Funcionais

| Papel      | Tokens                  | Uso                                     |
| ---------- | ----------------------- | --------------------------------------- |
| Sucesso    | `success-50/500/700`    | confirmação de operação concluída       |
| Atenção    | `warning-50/500/700`    | algo que exige conferência, sem impedir |
| Erro       | `danger-50/500/600/700` | falha, recusa e ação destrutiva         |
| Informação | `info-50/500/700`       | contexto neutro                         |

O `danger-600` (`#d92d20`) existe por um motivo medido: branco sobre o
`danger-500` dá **3,75:1**, abaixo do mínimo de 4,5:1 para texto pequeno. O
botão destrutivo usa o 600 (**4,8:1**); o 500 segue servindo a bordas e ícones,
onde o critério é outro. O problema foi encontrado por varredura automatizada
(axe-core) num botão real, não por inspeção visual.

## Papéis de superfície

Nomeados pela função, não pela cor: `--surface-page`, `--surface-raised`,
`--surface-sunken`, `--surface-inverted`, `--overlay-scrim`. Trocar o valor
muda a aplicação inteira sem caça a hexadecimais.

## Contraste verificado

Varredura axe-core (WCAG 2.1 A e AA) em sete superfícies — login, início,
listagem de usuários, ficha de acesso, perfis, vitrine e mobile: **zero
violações sérias ou críticas**.

Duas correções reais saíram dessa verificação:

1. `text-ink-400` (**2,57:1** sobre branco) era usado em texto de verdade —
   rótulos da sidebar e chaves de perfil/módulo. Passou para `text-ink-500`
   (**4,97:1**). O `ink-400` continua válido para **ícones**, onde o critério é
   o de elemento gráfico.
2. O botão destrutivo, descrito acima.

## Regra do vermelho

Vermelho comunica **destruição ou erro**. Nunca é usado para dar ênfase, marcar
"importante" ou decorar. Cor semântica gasta em decoração deixa de comunicar
justamente quando precisa.

## Modo escuro

**Não implementado.** A arquitetura está preparada — as cores já são papéis, não
valores soltos —, mas entregar meio modo escuro (alguns componentes certos e
outros ilegíveis) é pior do que não ter. Ver
[ADR-024](../adr/ADR-024-estrategia-de-tema.md).
