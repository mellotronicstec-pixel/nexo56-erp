# ADR-001 — Stack principal

**Status:** Aceito · **Data:** Prompt 01

## Contexto

O Prompt 01 pede uma stack TypeScript full-stack compatível com Hostinger
Business Web Hosting, com aplicação server-side, e prioriza **estabilidade
operacional** sobre novidade.

## Decisão

- **Next.js 16.3.5** (App Router, Server Components, Server Actions)
- **React 19.3**
- **TypeScript 5.9** em modo `strict`, com `noUncheckedIndexedAccess`
- **Node.js 22 LTS** (fixado em `engines` e `.nvmrc`)
- **Zod 4** para validação de entrada
- **Vitest 5** para testes
- **ESLint 9 + Prettier 3**
- **Tailwind CSS 4** apenas como mecanismo de tokens/utilitários

## Motivo

- Next.js entrega renderização no servidor, rotas de API e ações de formulário
  em um só processo Node — exatamente o que a hospedagem compartilhada suporta
  (um comando `npm start`, uma porta).
- Server Components mantêm regra de negócio e acesso a dados **no servidor**,
  o que reforça o requisito de que o frontend nunca é barreira de segurança.
- Node 22 é LTS, com suporte de longo prazo, e é a versão disponível no
  ambiente de verificação.
- ESLint foi fixado em **9.x** porque o `eslint-plugin-react` embarcado no
  `eslint-config-next@16` ainda não é compatível com ESLint 10 (verificado:
  `TypeError: contextOrFilename.getFilename is not a function`).

## Alternativas consideradas

| Alternativa                | Por que não                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js 15.x               | Linha anterior; 16.x é o canal estável atual e roda em Node 22. Começar um ERP de vida longa na linha anterior antecipa uma migração.               |
| NestJS + frontend separado | Dois processos e dois deploys; a hospedagem compartilhada roda um app Node. Contraria "não criar backend e frontend independentes sem necessidade". |
| Remix / SvelteKit          | Sem ganho concreto sobre Next para este caso e com menor familiaridade no ecossistema do projeto.                                                   |

## Consequências

- O projeto acompanha o ciclo de releases do Next; atualizações de major
  exigirão verificação de compatibilidade com a Hostinger.
- Server Actions exigem atenção a CSRF (tratado em ADR-006).
- ESLint fica na linha 9.x até o preset do Next suportar a 10 — registrado como
  dívida técnica no README.
