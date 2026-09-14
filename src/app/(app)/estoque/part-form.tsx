'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormField,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from '@/design-system/components';
import {
  PART_BARCODE_MAX,
  PART_BRAND_MAX,
  PART_CODE_MAX,
  PART_DESCRIPTION_MAX,
  PART_NAME_MAX,
  PART_NOTES_MAX,
  PART_NUMBER_MAX,
  UNITS_OF_MEASURE,
  UNIT_OF_MEASURE_LABEL,
} from '@/modules/inventory/domain/inventory';
import { EMPTY_INVENTORY_STATE, type InventoryActionState } from './action-state';

/**
 * Cadastro da peca (Prompt 10, itens 11 a 14).
 *
 * SO DOIS CAMPOS SAO OBRIGATORIOS: codigo interno e nome. Fabricante,
 * referencia e codigo de barras existem porque ajudam a achar a peca — e
 * exigi-los faria o balcao inventar valor para cadastrar um parafuso.
 */

type ActionFn = (
  previous: InventoryActionState,
  formData: FormData,
) => Promise<InventoryActionState>;

export interface PartFormValues {
  id?: string;
  code: string;
  name: string;
  description: string;
  brand: string;
  partNumber: string;
  barcode: string;
  unitOfMeasure: string;
  suggestedPrice: string;
  notes: string;
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

export function PartForm({
  action,
  values,
  submitLabel,
}: {
  action: ActionFn;
  values?: Partial<PartFormValues>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_INVENTORY_STATE);

  return (
    <form action={formAction} className="space-y-6">
      {values?.id ? <input type="hidden" name="partId" value={values.id} /> : null}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Card>
        <CardHeader
          title="Identificacao"
          description="O que a peca e. Quanto existe dela pertence ao saldo de cada unidade."
          headingLevel={2}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="part-code"
            label="Codigo interno"
            required
            hint="Como a loja chama a peca. Unico na empresa."
          >
            {(props) => (
              <Input
                {...props}
                name="code"
                required
                maxLength={PART_CODE_MAX}
                defaultValue={values?.code ?? ''}
                placeholder="TELA-01"
              />
            )}
          </FormField>

          <FormField id="part-name" label="Nome" required>
            {(props) => (
              <Input
                {...props}
                name="name"
                required
                maxLength={PART_NAME_MAX}
                defaultValue={values?.name ?? ''}
                placeholder="Tela LCD 32 polegadas"
              />
            )}
          </FormField>

          <FormField id="part-brand" label="Fabricante / marca">
            {(props) => (
              <Input
                {...props}
                name="brand"
                maxLength={PART_BRAND_MAX}
                defaultValue={values?.brand ?? ''}
              />
            )}
          </FormField>

          <FormField
            id="part-number"
            label="Part number / referencia"
            hint="Codigo do fabricante. Pode repetir entre fabricantes."
          >
            {(props) => (
              <Input
                {...props}
                name="partNumber"
                maxLength={PART_NUMBER_MAX}
                defaultValue={values?.partNumber ?? ''}
              />
            )}
          </FormField>

          <FormField
            id="part-barcode"
            label="Codigo de barras"
            hint="Opcional, em qualquer formato. Ainda nao ha leitor de camera."
          >
            {(props) => (
              <Input
                {...props}
                name="barcode"
                maxLength={PART_BARCODE_MAX}
                defaultValue={values?.barcode ?? ''}
              />
            )}
          </FormField>

          <FormField
            id="part-uom"
            label="Unidade de medida"
            required
            hint="Unidade e pacote nao aceitam quantidade fracionada."
          >
            {(props) => (
              <Select
                {...props}
                name="unitOfMeasure"
                defaultValue={values?.unitOfMeasure ?? 'unit'}
              >
                {UNITS_OF_MEASURE.map((unit) => (
                  <option key={unit} value={unit}>
                    {UNIT_OF_MEASURE_LABEL[unit]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField
            id="part-price"
            label="Preco sugerido de venda"
            hint="Informacao comercial. O valor que vale e o aprovado no orcamento."
          >
            {(props) => (
              <MoneyInput {...props} name="suggestedPrice" defaultValue={values?.suggestedPrice} />
            )}
          </FormField>

          <div className="sm:col-span-2">
            <FormField id="part-description" label="Descricao">
              {(props) => (
                <Input
                  {...props}
                  name="description"
                  maxLength={PART_DESCRIPTION_MAX}
                  defaultValue={values?.description ?? ''}
                />
              )}
            </FormField>
          </div>

          <div className="sm:col-span-2">
            <FormField
              id="part-notes"
              label="Observacoes tecnicas"
              hint="Recado de bancada. Nao sai para o cliente."
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="notes"
                  rows={3}
                  maxLength={PART_NOTES_MAX}
                  defaultValue={values?.notes ?? ''}
                />
              )}
            </FormField>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
