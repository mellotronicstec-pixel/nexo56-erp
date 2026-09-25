# Interface

## O componente

`src/app/(app)/ai/ai-writing-menu.tsx` — `AiWritingMenu`, reutilizável,
construído com os componentes existentes do Design System (`Menu`,
`MenuItem`, `Modal`, `Button`, `Spinner`). Recebe `surfaceKey`, `entityId`,
`tasks` (só as permitidas naquela superfície) e `currentText`, e devolve o
texto escolhido via `onApply`.

Botão discreto — "Melhorar com Nexo56 AI" — abre um menu/popover com as
tasks daquela superfície, nunca cinco botões grandes permanentes ao redor
de cada campo de texto.

## Nome de marca

A interface diz sempre **"Nexo56 AI"**. Nunca "ChatGPT", "Claude", "Gemini"
ou qualquer nome de provedor — o fornecedor é detalhe de infraestrutura,
nunca aparece na experiência do usuário.

## Fluxo visual

1. Usuário escolhe uma ação no menu. Botão fica desabilitado, `aria-busy`,
   com indicação visual de carregamento — sem permitir duplo clique.
2. Ao terminar, abre um preview com **Original** / **Sugestão Nexo56 AI**
   lado a lado, rotulado como rascunho (equivalente a "Rascunho gerado pela
   Nexo56 AI").
3. Duas ações: **Usar texto** (substitui o valor LOCAL do campo no
   formulário) ou **Descartar** (fecha o preview, nada muda).
4. Fechar o preview sem decidir preserva o texto original — mesmo
   comportamento de Descartar.
5. Erro do provedor: o texto original permanece, mensagem sanitizada, sem
   stack trace; o usuário pode tentar de novo manualmente (sem retry
   automático agressivo).

O textarea nunca é substituído antes da confirmação explícita de "Usar
texto" — a sugestão só existe no preview até essa decisão.

## Texto vazio / whitespace

Para as quatro tasks de reescrita, texto vazio ou só espaço não chama o
provedor — recusado localmente, sem custo de chamada. "Gerar parecer
técnico" pode funcionar sem texto atual no campo, porque ela usa o contexto
técnico já carregado no servidor — mas segue as mesmas regras de contexto
insuficiente quando não há dado bastante.

## Texto ainda não salvo

Se o usuário já digitou algo no campo mas não salvou, as ações de
reescrita operam sobre esse texto ATUAL — nunca recarregam o valor antigo
do banco. Por isso o campo de observação (interno da OS, nota do
orçamento) é controlado (`value` + `onChange`), não `defaultValue`: sem
esse ajuste, "Usar texto" não teria como saber qual era o texto mais
recente digitado.

## "Usar texto" nunca salva

Aplicar a sugestão marca o formulário como alterado (`dirty`), exatamente
como digitar manualmente — nunca dispara um save automático. Salvar
continua exigindo o botão/fluxo normal daquele formulário, com toda
validação e auditoria que já existiam antes da IA existir.

## Autorização determina visibilidade

O botão só aparece quando `ai.use` + `ai.writing` estão disponíveis PARA a
unidade da entidade (checado no servidor, na página, via `can()`) — nunca
é um botão sempre visível que falha ao clicar. Se o usuário não tem a
permissão de domínio do campo (por exemplo, só leitura em Ordens de
Serviço), "Usar texto" não é oferecido, porque não há capacidade de editar
aquele campo de qualquer forma.

## Onde está integrado hoje

- **Editor de Ordem de Serviço** (`ordens-de-servico/.../editar`):
  observações internas — `CORRIGIR_PORTUGUES`, `DEIXAR_MAIS_PROFISSIONAL`,
  `RESUMIR`, `GERAR_PARECER_TECNICO`.
- **Editor de Orçamento** (`.../orcamentos/[quoteId]`): notas para o
  cliente — `CORRIGIR_PORTUGUES`, `DEIXAR_MAIS_PROFISSIONAL`, `RESUMIR`,
  `DEIXAR_MAIS_CLARO_PARA_CLIENTE`.

Deliberadamente não espalhado por outras telas — o suficiente para provar a
arquitetura nas duas superfícies reais do catálogo, nunca mais.

## Acessibilidade e responsividade

Teclado, foco, rótulos, `aria-busy`, erro associado ao campo, diálogo/
popover acessível, estado nunca comunicado só por cor, carregamento
anunciado. Sem overflow horizontal em 360/390/768/1024/1280/1440/1920.
Alvo de toque adequado em mobile. Sem dark mode, sem white-label — mesmas
fontes e paleta do Design System existente (Sora para títulos, Inter para
corpo/UI).
