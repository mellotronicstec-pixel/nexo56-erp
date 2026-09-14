'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FormField,
  Input,
  Modal,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from '@/design-system/components';
import {
  LOCATION_CODE_MAX,
  LOCATION_DESCRIPTION_MAX,
  LOCATION_NAME_MAX,
  LOCATION_NAME_SUGGESTIONS,
  LOCATION_STATUS_LABEL,
} from '@/modules/inventory/domain/inventory';
import { EMPTY_INVENTORY_STATE, type InventoryActionState } from '../action-state';

/**
 * Localizacoes da unidade (Prompt 10, itens 8 a 10).
 *
 * SAO NOMES QUE A LOJA ESCOLHE, nao categorias do sistema. As sugestoes
 * existem so para a primeira tela nao comecar em branco — nada no dominio
 * consulta essa lista, e apagar todas as sugestoes nao quebra nada.
 */

type ActionFn = (
  previous: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;

export interface LocationRow {
  id: string;
  name: string;
  code: string | null;
  status: string;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

export function LocationManager({
  unitId,
  unitName,
  locations,
  canManage,
  createAction,
  updateAction,
}: {
  unitId: string;
  unitName: string;
  locations: LocationRow[];
  canManage: boolean;
  createAction: ActionFn;
  updateAction: ActionFn;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);

  const [createState, createFormAction] = useActionState(
    async (previous: InventoryActionState, formData: FormData) => {
      const result = await createAction(previous, formData);
      if (!result.error) setCreating(false);
      return result;
    },
    EMPTY_INVENTORY_STATE,
  );

  const [updateState, updateFormAction] = useActionState(
    async (previous: InventoryActionState, formData: FormData) => {
      const result = await updateAction(previous, formData);
      if (!result.error) setEditing(null);
      return result;
    },
    EMPTY_INVENTORY_STATE,
  );

  return (
    <Card>
      <CardHeader
        title={`Localizacoes da unidade ${unitName}`}
        description="Prateleira, gaveta, bancada — a posicao fisica dentro desta unidade. Nao e a unidade."
        headingLevel={2}
        action={
          canManage ? (
            <Button type="button" onClick={() => setCreating(true)}>
              Nova localizacao
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4 p-0">
        {createState.error ? (
          <div className="px-4 pt-4">
            <Alert tone="danger">{createState.error}</Alert>
          </div>
        ) : null}
        {updateState.error ? (
          <div className="px-4 pt-4">
            <Alert tone="danger">{updateState.error}</Alert>
          </div>
        ) : null}
        {(createState.success ?? updateState.success) ? (
          <div className="px-4 pt-4">
            <Alert tone="success">{createState.success ?? updateState.success}</Alert>
          </div>
        ) : null}

        {locations.length === 0 ? (
          <EmptyState
            title="Nenhuma localizacao cadastrada"
            description="Localizacao e opcional: o estoque funciona sem ela. Cadastre quando quiser saber em que prateleira a peca esta."
          />
        ) : (
          <Table caption="Localizacoes desta unidade">
            <THead>
              <TR>
                <TH>Nome</TH>
                <TH>Codigo</TH>
                <TH>Situacao</TH>
                <TH align="right" srOnly>
                  Acoes
                </TH>
              </TR>
            </THead>
            <TBody>
              {locations.map((location) => (
                <TR key={location.id}>
                  <TD className="font-medium text-ink-900">{location.name}</TD>
                  <TD>{location.code ?? <span className="text-ink-400">—</span>}</TD>
                  <TD>
                    <Badge tone={location.status === 'active' ? 'success' : 'neutral'}>
                      {LOCATION_STATUS_LABEL[location.status === 'active' ? 'active' : 'inactive']}
                    </Badge>
                  </TD>
                  <TD align="right">
                    {canManage ? (
                      <Button type="button" variant="ghost" onClick={() => setEditing(location)}>
                        Editar
                        <span className="sr-only"> a localizacao {location.name}</span>
                      </Button>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardBody>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Nova localizacao"
        description={`A localizacao pertence a unidade ${unitName} e nao serve para outra.`}
      >
        <form action={createFormAction} className="space-y-4">
          <input type="hidden" name="unitId" value={unitId} />

          <FormField id="location-name" label="Nome" required>
            {(props) => (
              <Input
                {...props}
                name="name"
                required
                maxLength={LOCATION_NAME_MAX}
                list="sugestoes-localizacao"
                placeholder={LOCATION_NAME_SUGGESTIONS[0]}
              />
            )}
          </FormField>
          <datalist id="sugestoes-localizacao">
            {LOCATION_NAME_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>

          <FormField id="location-code" label="Codigo" hint="Opcional. Unico dentro da unidade.">
            {(props) => <Input {...props} name="code" maxLength={LOCATION_CODE_MAX} />}
          </FormField>

          <FormField id="location-description" label="Descricao">
            {(props) => (
              <Textarea
                {...props}
                name="description"
                rows={2}
                maxLength={LOCATION_DESCRIPTION_MAX}
              />
            )}
          </FormField>

          <div className="flex flex-wrap justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Voltar
            </Button>
            <SubmitButton>Criar localizacao</SubmitButton>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar localizacao"
        description="Inativar nao apaga nada: o historico continua apontando para ela."
      >
        {editing ? (
          <form action={updateFormAction} className="space-y-4">
            <input type="hidden" name="locationId" value={editing.id} />

            <FormField id="location-edit-name" label="Nome" required>
              {(props) => (
                <Input
                  {...props}
                  name="name"
                  required
                  maxLength={LOCATION_NAME_MAX}
                  defaultValue={editing.name}
                />
              )}
            </FormField>

            <FormField id="location-edit-code" label="Codigo">
              {(props) => (
                <Input
                  {...props}
                  name="code"
                  maxLength={LOCATION_CODE_MAX}
                  defaultValue={editing.code ?? ''}
                />
              )}
            </FormField>

            <FormField id="location-edit-status" label="Situacao">
              {(props) => (
                <Select {...props} name="status" defaultValue={editing.status}>
                  <option value="active">Ativa</option>
                  <option value="inactive">Inativa</option>
                </Select>
              )}
            </FormField>

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Voltar
              </Button>
              <SubmitButton>Salvar</SubmitButton>
            </div>
          </form>
        ) : null}
      </Modal>
    </Card>
  );
}
