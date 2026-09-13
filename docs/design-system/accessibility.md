# Acessibilidade

Meta: **WCAG 2.1 nível AA** nas telas estruturais.

## O que foi verificado de verdade

Varredura **axe-core** (regras `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) em
navegador real, contra o **build de produção**:

| Superfície               | Violações sérias/críticas |
| ------------------------ | ------------------------- |
| Login                    | 0                         |
| Início                   | 0                         |
| Listagem de usuários     | 0                         |
| Ficha de acesso          | 0                         |
| Perfis de acesso         | 0                         |
| Vitrine do Design System | 0                         |
| Início em 390px (mobile) | 0                         |

**Lighthouse** (categoria Acessibilidade) na tela de login: **100**.
Performance 94, Boas práticas 96.

Verificação manual por teclado, em navegador: Tab, Shift+Tab, Enter, Esc, ordem
de foco, foco preso em gaveta, foco devolvido ao gatilho, menu abrindo e
fechando, e alvos de toque.

## Regras aplicadas

| Regra                                    | Onde vive                                            |
| ---------------------------------------- | ---------------------------------------------------- |
| HTML semântico antes de ARIA             | botão é `<button>`, link é `<a>`, tabela é `<table>` |
| Foco visível nunca removido              | `:focus-visible` global em `globals.css`             |
| Um `<h1>` por página                     | `PageHeader`                                         |
| Rótulo ligado ao campo                   | `FormField`                                          |
| Erro com texto e `aria-invalid`          | `FormField`                                          |
| Coluna de ações nomeada                  | `TH srOnly`                                          |
| Tabela com legenda                       | `Table caption`                                      |
| Ícone decorativo oculto                  | `aria-hidden` por padrão em `icons.tsx`              |
| Ícone informativo nomeado                | `title` → `role="img"`                               |
| Botão só com ícone tem nome              | `IconButton label` obrigatório                       |
| Esc, clique fora, foco preso e devolvido | `useDismissable`                                     |
| Regiões live corretas                    | `Alert` (status/alert), `Toast` (polite)             |
| Estado nunca só por cor                  | texto em `Badge`, `Alert`, erros de campo            |
| Alvos de 44px no mobile                  | `.touch-target`                                      |
| `prefers-reduced-motion` respeitado      | `globals.css`                                        |
| Atalho "Ir para o conteúdo"              | primeiro Tab do shell                                |

## Duas correções que saíram da verificação

1. **Contraste 2,57:1** — `text-ink-400` sobre branco em texto real (rótulos da
   sidebar, chaves de perfil e de módulo). Corrigido para `text-ink-500`
   (4,97:1). O `ink-400` segue válido para ícones.
2. **Contraste 3,75:1** — branco sobre `danger-500` no botão destrutivo pequeno.
   Criado o `danger-600` (`#d92d20`, 4,8:1).

Nenhuma das duas era visível a olho nu. Ambas foram medidas.

## Limitações declaradas

- A varredura cobre as telas **estruturais existentes**. Módulos futuros
  precisam repetir o processo — não herdam aprovação.
- Não houve teste com pessoas usuárias reais de tecnologia assistiva, nem com
  leitor de tela comercial (NVDA/JAWS/VoiceOver). O que existe é verificação
  automatizada + navegação por teclado.
- Lighthouse rodou na tela pública de login. As telas autenticadas foram
  verificadas por axe-core, não por Lighthouse.
- **Modo escuro não existe**, então não há contraste a verificar nele.
