# ADR-002 — Monólito modular

**Status:** Aceito · **Data:** Prompt 01

## Contexto

O Nexo56 crescerá para dezenas de módulos (OS, estoque, financeiro, garantias,
portal, IA). A Constituição proíbe microserviços prematuros e exige fronteiras
claras entre módulos.

## Decisão

Monólito modular, com o código organizado **por domínio**, não por camada
técnica global:

```
src/modules/<modulo>/
  domain/          regras e tipos puros, sem I/O
  application/     casos de uso e serviços
  infrastructure/  schema e acesso a dados
```

Não existem pastas globais `controllers/`, `services/`, `models/`.
`src/core/` guarda apenas infraestrutura genuinamente compartilhada
(configuração, banco, erros, log, IDs, contexto, rate limit).

## Motivo

- Um único processo, um único deploy — compatível com a infraestrutura inicial.
- Fronteiras por domínio permitem extrair um módulo depois, se escala ou
  operação justificar, sem reescrever o núcleo.
- A organização por domínio evita o "arquivo gigante de services" que a
  Constituição proíbe.

## Alternativas consideradas

| Alternativa                                   | Por que não                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Microserviços                                 | Infraestrutura distribuída sem necessidade real; proibido pela Constituição nesta fase.            |
| Camadas globais (`controllers/`, `services/`) | Perde o contexto de negócio e mistura módulos; explicitamente desaconselhado no Prompt 01, item 7. |
| Monorepo com pacotes por módulo               | Complexidade de build sem ganho nesta fase; possível depois, sem mudar a organização de pastas.    |

## Consequências

- Import entre módulos é permitido, mas visível — uma dependência indevida
  aparece no `import`, o que facilita auditoria.
- O schema do banco é agregado em `src/core/db/schema.ts` apenas para o
  drizzle-kit; a definição de cada tabela permanece no módulo dono.
