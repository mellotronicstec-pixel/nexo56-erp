# ADR-024 — Estratégia de tema: claro agora, escuro preparado

**Status:** Aceito · **Data:** Prompt 04

## Contexto

O Prompt 04 permite implementar modo escuro "se for simples e seguro" e exige
que, **se implementado**, todos os componentes fundamentais e contrastes
funcionem nele (item 10).

O Nexo56 tem hoje 31 componentes, 14 rotas e uma paleta com quatro escalas.

## Decisão

**Modo escuro não é implementado nesta fase.** A arquitetura fica preparada:

1. Cores são expostas como **papéis** (`--surface-page`, `--surface-raised`,
   `--border-default`, `--text-muted`), não como valores soltos nos componentes.
2. Nenhum componente escreve `#hex`, `bg-white` fixo em contexto temático ou
   sombra própria — tudo vem de token.
3. Trocar o tema passa a ser redefinir o bloco de papéis, não varrer 31 arquivos.

## Motivo

Modo escuro não é inverter cores: é uma segunda paleta completa, com contraste
verificado em cada estado de cada componente — foco, desabilitado, etiqueta,
aviso, sobreposição, esqueleto de carregamento. Meio modo escuro (alguns
componentes certos, outros ilegíveis) é pior do que nenhum: a pessoa liga, algo
fica impossível de ler, e ela desconfia do produto inteiro.

O item 10 também diz, com todas as letras, para **não sacrificar consistência**
a fim de implementá-lo. Com os módulos de negócio ainda por vir — cada um
trazendo telas novas —, um modo escuro entregue agora precisaria ser reverificado
a cada prompt.

A preparação, essa sim, precisa existir agora: refatorar cor depois de
quinze módulos escritos é caro; nomear papéis desde o começo não custa nada.

## Alternativas descartadas

| Alternativa                            | Por que não                                               |
| -------------------------------------- | --------------------------------------------------------- |
| Implementar modo escuro completo agora | segunda paleta para reverificar a cada módulo novo        |
| `prefers-color-scheme` sem verificação | entrega contraste não medido; pior que não ter            |
| Inversão automática por filtro CSS     | destrói a identidade e o significado das cores funcionais |
| Nem preparar a arquitetura             | empurra uma refatoração cara para depois de 15 módulos    |

## Consequências

- Quem espera modo escuro não o encontra — e a documentação diz isso
  explicitamente, em vez de deixar a pessoa procurando.
- Quando for implementado, o trabalho é redefinir papéis e **verificar
  contraste**, não reescrever componentes.
- O tema claro é o único, então toda verificação de contraste feita aqui vale
  integralmente.
