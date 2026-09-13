# Componentes

Importe sempre de `@/design-system/components`.

## Ação

### `Button`

Variantes `primary` · `secondary` · `outline` · `ghost` · `destructive` · `link`.
Tamanhos `lg` · `md` · `sm`. Props: `loading`, `fullWidth`, `disabled`.

`loading` implica `disabled` e marca `aria-busy` — duplo envio não acontece por
acidente. **Use `destructive` só para ação destrutiva.**

❌ Não use `Button` para navegar. Link é `<Link>` com `linkButtonClass()`.

### `IconButton`

`label` é **obrigatório** — sem texto visível, é o único nome acessível. Vira
`aria-label` e `title`.

## Formulário

### `FormField` (alias `Field`)

Junta rótulo, dica, controle e erro com as ligações corretas: `label[for]`,
`aria-describedby`, `aria-invalid`, `aria-required`. Recebe o controle por
função e repassa as props prontas.

```tsx
<FormField id="email" label="E-mail" required error={state.error}>
  {(props) => <Input {...props} name="email" type="email" />}
</FormField>
```

❌ Nunca use placeholder como rótulo. Ele some ao digitar e não é lido.

### `Input` · `Textarea` · `Select`

Mesma aparência, mesmos estados (`disabled`, `readOnly`, `invalid`). `Select` é
**nativo** de propósito: acessível, com teclado, e no celular abre o seletor do
sistema.

### `PasswordInput`

Alterna visibilidade com `aria-pressed`. Mostrar a senha é recurso de
acessibilidade — quem digita uma frase longa no celular precisa conferir.

### `Checkbox` · `Radio` · `Switch`

Inputs nativos com aparência ajustada. O rótulo envolve o controle, então
clicar no texto alterna. `Switch` é para efeito **imediato**; `Checkbox` para
formulário que só vale ao enviar.

### `SearchField`

`type="search"`, rótulo obrigatório (oculto por padrão). É a **primitiva** — a
busca global do produto não existe e não é simulada.

### `FilterBar`

`<form method="get">`: filtros viram query string, a URL descreve a tela e
recarregar não perde a seleção. Mostra as etiquetas do que está aplicado.

## Conteúdo

`Card` (+ `CardHeader`, `CardBody`, `CardFooter`) · `MetricCard` ·
`Section` · `Divider` · `Badge` · `Alert` · `Avatar`.

`MetricCard` é **só visual**: não calcula e não busca. Nenhuma tela desta fase
exibe KPI, porque nenhum módulo de negócio existe ainda para produzir um.

`Alert` usa `role="alert"` apenas em `tone="danger"`; os demais usam
`role="status"`, para não interromper leitores de tela com informação não
urgente.

## Tabela

`Table` + `THead` / `TBody` / `TR` / `TH` / `TD`, e `CardList` / `CardListItem`
para a face mobile.

`Table` exige `caption` (oculto visualmente) e `TH` aceita `srOnly` para a
coluna de ações — sem rótulo visível, mas nomeada.

**Padrão obrigatório:** tabela dentro de `<div className="hidden md:block">` e
`CardList` com `className="md:hidden"`, com os **mesmos dados**.

## Navegação

`PageHeader` (o único `<h1>` da página) · `Breadcrumb` · `Tabs` (cada aba é uma
URL) · `Pagination` (links, não botões) · `Menu` + `MenuItem` / `MenuHeader` /
`MenuSeparator` / `MENU_ROW`.

## Sobreposição

`Modal` · `Drawer` · `Tooltip` · `ToastProvider` + `useToast`.

Modal e gaveta compartilham `useDismissable`: Esc fecha, clique fora fecha, o
foco entra e circula dentro, e volta ao gatilho ao fechar. Armadilha de foco
meio implementada é pior que nenhuma — por isso o comportamento é escrito uma
vez só.

**Toast nunca é a única comunicação de erro crítico.** Ele some sozinho; erro
que exige ação continua junto do campo ou como `Alert` persistente. Toasts de
erro não somem automaticamente.

## Estado

`EmptyState` · `ErrorState` · `Skeleton` / `SkeletonText` · `Spinner`.

`EmptyState` distingue "não há nada ainda" de "o filtro não achou nada" — o
texto muda. `Skeleton` é sempre `aria-hidden`: quem usa leitor de tela não ganha
nada ouvindo "carregando" seis vezes.

`ErrorState` nunca mostra stack trace, nome de tabela ou detalhe interno.

## Ícones

`@/design-system/icons` — família única, grade 24, traço 1.5, `currentColor`,
`aria-hidden` salvo quando recebem `title`. Ver
[ADR-023](../adr/ADR-023-conjunto-de-icones.md).

## Não construído de propósito

Data grid empresarial, editor rich text, kanban, calendário completo, gráficos,
uploader complexo e linha do tempo de OS. Cada um chega com o módulo que o
justificar — construir antes é adivinhar requisito.

## Testado

22 testes de componente em `tests/component/components.test.tsx`: clique,
teclado, `disabled`, `loading`, foco, ligação de rótulo, erro, nome acessível,
`aria-modal`, Esc, e ordem de página na paginação. Os testes verificam
comportamento e acessibilidade — **não** aparência: teste preso a classe CSS só
gera manutenção.
