# Padrões de tela

Dois padrões cobrem quase todo ERP. Módulos futuros seguem estes — não inventam
uma terceira forma.

## Listagem

```
PageHeader  (breadcrumbs · título · descrição · metadados · ações)
    ↓
FilterBar   (busca, filtros, filtros aplicados, limpar)   — quando houver
    ↓
Card
  ├─ Table     (hidden md:block)   ─┐ mesmos dados
  └─ CardList  (md:hidden)         ─┘
    ↓
Pagination
```

Estados obrigatórios: **carregando**, **vazio** e **erro**. Uma lista vazia sem
explicação parece tela quebrada; e "vazio" por filtro tem texto diferente de
"vazio" por não haver nada ainda.

Implementado em `/administracao/usuarios`, `/administracao/unidades` e
`/administracao/auditoria`.

## Detalhe

```
PageHeader  (breadcrumbs com o nome real do registro · ações contextuais)
    ↓
Resumo      (o essencial antes de qualquer aba)
    ↓
Section…    (cada bloco com título próprio, ligado por aria-labelledby)
    ↓
Histórico   (quando existir)
```

Implementado em `/administracao/usuarios/[userId]` e
`/administracao/perfis/[roleId]`.

## Formulário

Uma coluna por padrão; duas colunas no desktop apenas quando os campos são
curtos e relacionados — no mobile sempre uma. Ações no rodapé
(`CardFooter`), com o botão principal por último no DOM e **primeiro na tela**
em telas pequenas (`flex-col-reverse`).

Regras:

- rótulo sempre visível, nunca substituído por placeholder;
- erro **junto do campo**, em português claro, preservando o valor digitado;
- erro nunca depende só de cor (texto + `aria-invalid`);
- envio bloqueia duplo clique e mostra progresso (`Button loading`).

## Ação destrutiva

Confirmação contextual que descreve **o efeito**, não um "Tem certeza?" solto:

> "Remover o vínculo também remove os perfis que valiam nesta unidade.
> Continuar?"

O botão de confirmação usa `variant="destructive"`; o de escape vem antes.

## Consciência de acesso

Componentes podem refletir permissão e disponibilidade de módulo — o menu some,
o botão não aparece, a tela explica em vez de esconder. **O backend continua
sendo a autoridade**: cada página e cada Server Action revalida. A interface
nunca é a barreira (Prompts 01 a 03).

## Estados de funcionalidade

A tela de Módulos representa, com etiqueta em português: `ativo`, `inativo`,
`indisponível no plano`, `dependência necessária`, `descontinuada`, `estrutural`
e `beta`. O layout se reorganiza quando um módulo some — nada de buraco no lugar.

## Alterações não salvas

O padrão está **planejado**, não implementado: hoje nenhuma tela mantém rascunho
longo o bastante para justificar o aviso. Implementar globalmente sem caso real
custaria falsos positivos em todo formulário.
