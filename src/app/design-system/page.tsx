import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShowcaseClient } from './showcase-client';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardList,
  CardListItem,
  Checkbox,
  Divider,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  MetricCard,
  PageHeader,
  Pagination,
  PasswordInput,
  Radio,
  SearchField,
  Section,
  Select,
  Skeleton,
  SkeletonText,
  Spinner,
  Switch,
  Table,
  Tabs,
  TBody,
  TD,
  Textarea,
  TH,
  THead,
  TR,
} from '@/design-system/components';
import { IconPlus, IconSearch, IconUsers } from '@/design-system/icons';

export const metadata: Metadata = { title: 'Design System' };

/**
 * Vitrine do Design System (Prompt 04, item 82).
 *
 * DISPONIVEL SOMENTE FORA DE PRODUCAO. Em producao devolve 404 — nao e uma
 * tela do produto, e sim a referencia viva de quem constroi as telas.
 *
 * Os dados aqui sao claramente demonstrativos e NAO tocam o banco (item 122):
 * nada e inserido, nada e lido, nenhum numero representa operacao real.
 */
export default function DesignSystemPage() {
  // `process.env.NODE_ENV` e constante de build, avaliada sem tocar a
  // validacao completa de ambiente — a vitrine nao precisa de banco, segredo
  // nem URL publica para responder "estou em producao?".
  if (process.env.NODE_ENV === 'production') notFound();

  const typography = [
    { token: 'text-display', label: 'Display', family: 'Sora 700', sample: 'Nexo56' },
    { token: 'text-h1', label: 'H1', family: 'Sora 700', sample: 'Ordens de servico' },
    { token: 'text-h2', label: 'H2', family: 'Sora 600', sample: 'Ordens de servico' },
    { token: 'text-h3', label: 'H3', family: 'Sora 600', sample: 'Ordens de servico' },
    { token: 'text-h4', label: 'H4', family: 'Sora 600', sample: 'Ordens de servico' },
    { token: 'text-h5', label: 'H5', family: 'Sora 600', sample: 'Ordens de servico' },
    { token: 'text-h6', label: 'H6', family: 'Sora 600', sample: 'Ordens de servico' },
  ] as const;

  const body = [
    { token: 'text-body-lg', label: 'Corpo grande', family: 'Inter 400' },
    { token: 'text-body', label: 'Corpo', family: 'Inter 400' },
    { token: 'text-ui', label: 'Interface', family: 'Inter 400/500' },
    { token: 'text-small', label: 'Pequeno', family: 'Inter 400/500' },
  ] as const;

  const brandScale = [
    'bg-brand-50',
    'bg-brand-100',
    'bg-brand-200',
    'bg-brand-300',
    'bg-brand-400',
    'bg-brand-500',
    'bg-brand-600',
    'bg-brand-700',
    'bg-brand-800',
    'bg-brand-900',
  ];

  const inkScale = [
    'bg-ink-25',
    'bg-ink-50',
    'bg-ink-100',
    'bg-ink-200',
    'bg-ink-300',
    'bg-ink-400',
    'bg-ink-500',
    'bg-ink-600',
    'bg-ink-700',
    'bg-ink-800',
    'bg-ink-900',
  ];

  return (
    <main className="min-h-dvh bg-(--surface-page) px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <PageHeader
          eyebrow="Referencia interna"
          title="Design System do Nexo56"
          description="Todos os componentes, tokens e estados que as telas do produto reutilizam. Esta pagina nao existe em producao e nao le nem grava dado algum."
          breadcrumbs={[{ label: 'Interno' }, { label: 'Design System' }]}
        />

        <Alert tone="warning" title="Pagina de desenvolvimento">
          Os textos e numeros abaixo sao demonstrativos. Nenhum representa operacao real da empresa.
        </Alert>

        {/* ---------------------------------------------------- tipografia */}
        <Section
          id="tipografia"
          title="Tipografia"
          description="Sora nos titulos; Inter na interface. Abaixo de 768px os titulos encolhem — o texto de interface nao."
        >
          <Card>
            <CardBody className="space-y-4">
              {typography.map((item) => (
                <div key={item.token} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className={`${item.token} font-heading font-semibold text-ink-900`}>
                    {item.sample}
                  </span>
                  <code className="text-small text-ink-500">
                    {item.token} · {item.family}
                  </code>
                </div>
              ))}
              <Divider />
              {body.map((item) => (
                <div key={item.token} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className={`${item.token} text-ink-800`}>
                    O tecnico registrou a troca da placa-mae.
                  </span>
                  <code className="text-small text-ink-500">
                    {item.token} · {item.family}
                  </code>
                </div>
              ))}
            </CardBody>
          </Card>
        </Section>

        {/* --------------------------------------------------------- cores */}
        <Section
          id="cores"
          title="Cores"
          description="Institucionais e funcionais. As funcionais servem a semantica, nunca a decoracao."
        >
          <div className="space-y-4">
            <Card>
              <CardHeader title="Azul institucional" description="#0066FF e sua escala" />
              <CardBody>
                <div className="flex flex-wrap gap-2">
                  {brandScale.map((tone) => (
                    <div key={tone} className="text-center">
                      <div className={`size-12 rounded-md border border-ink-200 ${tone}`} />
                      <code className="mt-1 block text-small text-ink-500">
                        {tone.replace('bg-', '')}
                      </code>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Neutros" description="Derivados de #101828" />
              <CardBody>
                <div className="flex flex-wrap gap-2">
                  {inkScale.map((tone) => (
                    <div key={tone} className="text-center">
                      <div className={`size-12 rounded-md border border-ink-200 ${tone}`} />
                      <code className="mt-1 block text-small text-ink-500">
                        {tone.replace('bg-', '')}
                      </code>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Funcionais" description="Sucesso, atencao, erro e informacao" />
              <CardBody className="space-y-2">
                <Alert tone="success" title="Operacao concluida">
                  O perfil foi atualizado.
                </Alert>
                <Alert tone="warning" title="Confira antes de continuar">
                  Este perfil ainda nao tem nenhuma permissao.
                </Alert>
                <Alert tone="danger" title="Nao foi possivel concluir">
                  Voce nao pode conceder permissoes que nao possui.
                </Alert>
                <Alert tone="info" title="Desativar nao apaga dados">
                  O historico permanece disponivel apos a reativacao.
                </Alert>
              </CardBody>
            </Card>
          </div>
        </Section>

        {/* ------------------------------------------------------- botoes */}
        <Section id="botoes" title="Botoes" description="Inter 600, sem caixa alta.">
          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button>Primario</Button>
                <Button variant="secondary">Secundario</Button>
                <Button variant="outline">Contorno</Button>
                <Button variant="ghost">Discreto</Button>
                <Button variant="destructive">Destrutivo</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="lg">Grande</Button>
                <Button size="md">Padrao</Button>
                <Button size="sm">Compacto</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button loading>Carregando</Button>
                <Button disabled>Desabilitado</Button>
                <Button>
                  <IconPlus size={18} />
                  Com icone
                </Button>
              </div>
            </CardBody>
          </Card>
        </Section>

        {/* --------------------------------------------------- formularios */}
        <Section
          id="formularios"
          title="Formularios"
          description="Rotulo sempre visivel; erro junto do campo, em portugues, nunca so por cor."
        >
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <FormField id="ds-nome" label="Nome" required hint="Como aparece nas telas.">
                {(props) => <Input {...props} defaultValue="Ana Ribeiro" />}
              </FormField>

              <FormField id="ds-email" label="E-mail" error="Informe um e-mail valido.">
                {(props) => <Input {...props} type="email" defaultValue="ana@" />}
              </FormField>

              <FormField id="ds-senha" label="Senha" required>
                {(props) => <PasswordInput {...props} defaultValue="frase-longa-de-teste" />}
              </FormField>

              <FormField id="ds-unidade" label="Unidade">
                {(props) => (
                  <Select {...props} defaultValue="norte">
                    <option value="norte">Unidade Norte</option>
                    <option value="sul">Unidade Sul</option>
                  </Select>
                )}
              </FormField>

              <FormField id="ds-obs" label="Observacoes" className="sm:col-span-2">
                {(props) => <Textarea {...props} placeholder="Detalhes do atendimento" />}
              </FormField>

              <div className="space-y-2">
                <Checkbox name="ds-check" label="Encerrar as outras sessoes" defaultChecked />
                <Radio name="ds-escopo" label="Vale no tenant inteiro" defaultChecked />
                <Radio name="ds-escopo" label="Somente nesta unidade" />
                <Switch name="ds-switch" label="Modulo ativo" defaultChecked />
              </div>

              <div className="space-y-2">
                <SearchField id="ds-busca" label="Buscar" placeholder="Buscar usuario" />
                <Input placeholder="Desabilitado" disabled />
                <Input placeholder="Somente leitura" readOnly defaultValue="Valor fixo" />
              </div>
            </CardBody>
            <CardFooter>
              <Button variant="secondary">Cancelar</Button>
              <Button>Salvar</Button>
            </CardFooter>
          </Card>
        </Section>

        {/* -------------------------------------------------------- badges */}
        <Section id="badges" title="Etiquetas" description="Estado em uma palavra.">
          <Card>
            <CardBody className="flex flex-wrap gap-2">
              <Badge>neutra</Badge>
              <Badge tone="brand">marca</Badge>
              <Badge tone="success">ativo</Badge>
              <Badge tone="warning">atencao</Badge>
              <Badge tone="danger">erro</Badge>
            </CardBody>
          </Card>
        </Section>

        {/* --------------------------------------------------------- cards */}
        <Section id="cards" title="Cartoes" description="Inclui o cartao de indicador.">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Exemplo de indicador" value="—" hint="Sem dado real nesta fase" />
            <MetricCard label="Outro indicador" value="—" hint="Componente apenas visual" />
            <Card interactive>
              <CardBody>
                <p className="font-heading text-h5 font-semibold text-ink-900">Cartao clicavel</p>
                <p className="mt-1 text-small text-ink-500">
                  O elemento interativo real e o link dentro dele.
                </p>
              </CardBody>
            </Card>
          </div>
        </Section>

        {/* -------------------------------------------------------- tabela */}
        <Section
          id="tabelas"
          title="Tabelas"
          description="Tabela a partir de 768px; cartoes abaixo disso. Reduza a janela para ver a troca."
        >
          <Card>
            <CardBody className="p-0">
              <div className="hidden md:block">
                <Table caption="Exemplo demonstrativo de tabela">
                  <THead>
                    <TR>
                      <TH>Nome</TH>
                      <TH>E-mail</TH>
                      <TH>Situacao</TH>
                    </TR>
                  </THead>
                  <TBody>
                    <TR>
                      <TD className="font-medium text-ink-900">Ana Ribeiro</TD>
                      <TD>ana@exemplo.invalid</TD>
                      <TD>
                        <Badge tone="success">ativo</Badge>
                      </TD>
                    </TR>
                    <TR>
                      <TD className="font-medium text-ink-900">Bruno Alves</TD>
                      <TD>bruno@exemplo.invalid</TD>
                      <TD>
                        <Badge>inativo</Badge>
                      </TD>
                    </TR>
                  </TBody>
                </Table>
              </div>

              <CardList label="Exemplo demonstrativo em cartoes" className="md:hidden">
                <CardListItem>
                  <p className="font-medium text-ink-900">Ana Ribeiro</p>
                  <p className="text-small text-ink-500">ana@exemplo.invalid</p>
                </CardListItem>
                <CardListItem>
                  <p className="font-medium text-ink-900">Bruno Alves</p>
                  <p className="text-small text-ink-500">bruno@exemplo.invalid</p>
                </CardListItem>
              </CardList>

              <Pagination page={2} pageCount={5} hrefFor={(page) => `/design-system?p=${page}`} />
            </CardBody>
          </Card>
        </Section>

        {/* ---------------------------------------------------------- abas */}
        <Section id="abas" title="Abas" description="Cada aba e uma URL propria.">
          <Tabs
            activeHref="/design-system"
            items={[
              { href: '/design-system', label: 'Componentes', count: 31 },
              { href: '/design-system?aba=padroes', label: 'Padroes' },
              { href: '/design-system?aba=estados', label: 'Estados' },
            ]}
          />
        </Section>

        {/* -------------------------------------------- modal/gaveta/menu */}
        <Section
          id="sobreposicoes"
          title="Modal, gaveta, menu, dica e aviso"
          description="Tudo com Esc, clique fora, foco preso e foco devolvido. Teste pelo teclado."
        >
          <Card>
            <CardBody>
              <ShowcaseClient />
            </CardBody>
          </Card>
        </Section>

        {/* ------------------------------------------------------- estados */}
        <Section
          id="estados"
          title="Estados"
          description="Carregando, vazio e erro — os tres que toda lista precisa ter."
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-center gap-2 text-ink-600">
                  <Spinner />
                  <span className="text-ui">Carregando</span>
                </div>
                <SkeletonText lines={3} />
                <Skeleton className="h-8 w-24" />
              </CardBody>
            </Card>
            <Card>
              <EmptyState
                title="Nenhum usuario"
                description="Esta empresa ainda nao possui usuarios."
                icon={<IconUsers />}
                action={<Button size="sm">Criar usuario</Button>}
              />
            </Card>
            <Card>
              <ErrorState
                action={
                  <Button size="sm" variant="secondary">
                    Tentar novamente
                  </Button>
                }
              />
            </Card>
          </div>
          <Card className="mt-3">
            <EmptyState
              title="Nenhum resultado para o filtro"
              description="Nenhum usuario corresponde aos filtros aplicados. Limpe os filtros para ver todos."
              icon={<IconSearch />}
            />
          </Card>
        </Section>
      </div>
    </main>
  );
}
