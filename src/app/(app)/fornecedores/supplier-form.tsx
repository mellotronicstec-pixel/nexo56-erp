'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  FormField,
  Input,
  Select,
  Textarea,
} from '@/design-system/components';
import {
  SUPPLIER_CONTACT_NAME_MAX,
  SUPPLIER_EMAIL_MAX,
  SUPPLIER_KINDS,
  SUPPLIER_KIND_LABEL,
  SUPPLIER_LEAD_TIME_MAX_DAYS,
  SUPPLIER_NAME_MAX,
  SUPPLIER_NOTES_MAX,
  SUPPLIER_PHONE_MAX,
  SUPPLIER_TERMS_MAX,
  SUPPLIER_TRADE_NAME_MAX,
  SUPPLIER_WEBSITE_MAX,
} from '@/modules/purchasing/domain/purchasing';
import { EMPTY_PURCHASING_STATE, type PurchasingActionState } from '../compras/action-state';

/**
 * Cadastro do fornecedor (Prompt 11, itens 4 e 5).
 *
 * SO O NOME E OBRIGATORIO. CNPJ e opcional de proposito: o balcao compra
 * parafuso da loja da esquina, e exigir documento faria alguem inventar um.
 * Quando o documento e informado, ele e validado de verdade — mascara certa
 * com digito errado nao passa.
 *
 * FORNECEDOR NAO E FABRICANTE. A marca da peca continua no cadastro da peca;
 * nada aqui transforma "Samsung" em empresa com quem se negocia.
 */

type ActionFn = (
  previous: PurchasingActionState,
  formData: FormData,
) => Promise<PurchasingActionState>;

export interface SupplierContactValues {
  role: string;
  name: string;
  email: string;
  phone: string;
}

export interface SupplierFormValues {
  id?: string;
  kind: string;
  name: string;
  tradeName: string;
  document: string;
  stateRegistration: string;
  email: string;
  phone: string;
  phoneIsWhatsapp: boolean;
  website: string;
  zipCode: string;
  street: string;
  addressNumber: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  leadTimeDays: string;
  commercialTerms: string;
  notes: string;
  contacts: SupplierContactValues[];
}

const EMPTY_CONTACT: SupplierContactValues = {
  role: 'commercial',
  name: '',
  email: '',
  phone: '',
};

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={pending}>
      {children}
    </Button>
  );
}

export function SupplierForm({
  action,
  values,
  submitLabel,
}: {
  action: ActionFn;
  values?: Partial<SupplierFormValues>;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_PURCHASING_STATE);

  /**
   * As linhas de contato sao uma lista que cresce no cliente. O estado guarda
   * apenas QUANTAS linhas existem — o conteudo continua vivendo no proprio
   * `<input>`, que e quem o `<form>` envia. Espelhar o texto em `useState`
   * daria duas fontes de verdade para o mesmo campo.
   */
  const [contactRows, setContactRows] = useState<SupplierContactValues[]>(
    values?.contacts?.length ? values.contacts : [EMPTY_CONTACT],
  );

  const addContact = () => setContactRows((rows) => [...rows, EMPTY_CONTACT]);
  const removeContact = (index: number) =>
    setContactRows((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== index)));

  return (
    <form action={formAction} className="space-y-6">
      {values?.id ? <input type="hidden" name="supplierId" value={values.id} /> : null}

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}

      <Card>
        <CardHeader
          title="Identificacao"
          description="Quem e a empresa. O cadastro vale para todas as unidades."
          headingLevel={2}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormField id="supplier-kind" label="Tipo" required>
            {(props) => (
              <Select {...props} name="kind" defaultValue={values?.kind ?? 'company'}>
                {SUPPLIER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {SUPPLIER_KIND_LABEL[kind]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>

          <FormField id="supplier-name" label="Razao social ou nome" required>
            {(props) => (
              <Input
                {...props}
                name="name"
                required
                maxLength={SUPPLIER_NAME_MAX}
                defaultValue={values?.name ?? ''}
                placeholder="Distribuidora Central de Pecas Ltda"
              />
            )}
          </FormField>

          <FormField id="supplier-trade-name" label="Nome fantasia">
            {(props) => (
              <Input
                {...props}
                name="tradeName"
                maxLength={SUPPLIER_TRADE_NAME_MAX}
                defaultValue={values?.tradeName ?? ''}
              />
            )}
          </FormField>

          <FormField
            id="supplier-document"
            label="CNPJ ou CPF"
            hint="Opcional. Se informado, e validado e nao pode repetir na empresa."
          >
            {(props) => (
              <Input
                {...props}
                name="document"
                inputMode="numeric"
                maxLength={20}
                defaultValue={values?.document ?? ''}
                placeholder="00.000.000/0000-00"
              />
            )}
          </FormField>

          <FormField id="supplier-ie" label="Inscricao estadual">
            {(props) => (
              <Input
                {...props}
                name="stateRegistration"
                maxLength={32}
                defaultValue={values?.stateRegistration ?? ''}
              />
            )}
          </FormField>

          <FormField
            id="supplier-lead-time"
            label="Prazo de entrega prometido (dias)"
            hint="O que o fornecedor promete. O prazo real e medido a cada recebimento."
          >
            {(props) => (
              <Input
                {...props}
                name="leadTimeDays"
                type="number"
                min={0}
                max={SUPPLIER_LEAD_TIME_MAX_DAYS}
                defaultValue={values?.leadTimeDays ?? ''}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Contato principal" headingLevel={2} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormField id="supplier-phone" label="Telefone">
            {(props) => (
              <Input
                {...props}
                name="phone"
                type="tel"
                inputMode="tel"
                maxLength={SUPPLIER_PHONE_MAX}
                defaultValue={values?.phone ?? ''}
              />
            )}
          </FormField>

          <FormField id="supplier-email" label="E-mail">
            {(props) => (
              <Input
                {...props}
                name="email"
                type="email"
                maxLength={SUPPLIER_EMAIL_MAX}
                defaultValue={values?.email ?? ''}
              />
            )}
          </FormField>

          <div className="sm:col-span-2">
            <Checkbox
              name="phoneIsWhatsapp"
              label="Este telefone tem WhatsApp"
              hint="Anotacao de contato. O Nexo56 nao envia mensagem nenhuma."
              defaultChecked={values?.phoneIsWhatsapp ?? false}
            />
          </div>

          <div className="sm:col-span-2">
            <FormField id="supplier-website" label="Site">
              {(props) => (
                <Input
                  {...props}
                  name="website"
                  maxLength={SUPPLIER_WEBSITE_MAX}
                  defaultValue={values?.website ?? ''}
                />
              )}
            </FormField>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Endereco"
          description="Onde a empresa fica. Opcional — serve para a nota e para a conferencia."
          headingLevel={2}
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormField id="supplier-zip" label="CEP">
            {(props) => (
              <Input
                {...props}
                name="zipCode"
                inputMode="numeric"
                maxLength={9}
                defaultValue={values?.zipCode ?? ''}
              />
            )}
          </FormField>

          <FormField id="supplier-street" label="Logradouro">
            {(props) => (
              <Input {...props} name="street" maxLength={200} defaultValue={values?.street ?? ''} />
            )}
          </FormField>

          <FormField id="supplier-number" label="Numero">
            {(props) => (
              <Input
                {...props}
                name="addressNumber"
                maxLength={20}
                defaultValue={values?.addressNumber ?? ''}
              />
            )}
          </FormField>

          <FormField id="supplier-complement" label="Complemento">
            {(props) => (
              <Input
                {...props}
                name="complement"
                maxLength={120}
                defaultValue={values?.complement ?? ''}
              />
            )}
          </FormField>

          <FormField id="supplier-district" label="Bairro">
            {(props) => (
              <Input
                {...props}
                name="district"
                maxLength={120}
                defaultValue={values?.district ?? ''}
              />
            )}
          </FormField>

          <FormField id="supplier-city" label="Cidade">
            {(props) => (
              <Input {...props} name="city" maxLength={120} defaultValue={values?.city ?? ''} />
            )}
          </FormField>

          <FormField id="supplier-state" label="UF">
            {(props) => (
              <Input
                {...props}
                name="state"
                maxLength={2}
                defaultValue={values?.state ?? ''}
                placeholder="SP"
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Contatos"
          description="As pessoas com quem se fala: o vendedor e, quando existe, o financeiro."
          headingLevel={2}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={addContact}>
              Adicionar contato
            </Button>
          }
        />
        <CardBody className="space-y-4">
          {contactRows.map((contact, index) => (
            <fieldset
              key={`contato-${index}`}
              className="grid gap-3 rounded-lg border border-ink-200 p-4 sm:grid-cols-4"
            >
              <legend className="px-1 text-small font-medium text-ink-600">
                Contato {index + 1}
              </legend>

              <FormField id={`contact-name-${index}`} label="Nome">
                {(props) => (
                  <Input
                    {...props}
                    name="contactName"
                    maxLength={SUPPLIER_CONTACT_NAME_MAX}
                    defaultValue={contact.name}
                  />
                )}
              </FormField>

              <FormField id={`contact-role-${index}`} label="Papel">
                {(props) => (
                  <Select {...props} name="contactRole" defaultValue={contact.role}>
                    <option value="commercial">Comercial</option>
                    <option value="financial">Financeiro</option>
                    <option value="other">Outro</option>
                  </Select>
                )}
              </FormField>

              <FormField id={`contact-phone-${index}`} label="Telefone">
                {(props) => (
                  <Input
                    {...props}
                    name="contactPhone"
                    type="tel"
                    inputMode="tel"
                    maxLength={SUPPLIER_PHONE_MAX}
                    defaultValue={contact.phone}
                  />
                )}
              </FormField>

              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FormField id={`contact-email-${index}`} label="E-mail">
                    {(props) => (
                      <Input
                        {...props}
                        name="contactEmail"
                        type="email"
                        maxLength={SUPPLIER_EMAIL_MAX}
                        defaultValue={contact.email}
                      />
                    )}
                  </FormField>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeContact(index)}
                  disabled={contactRows.length === 1}
                >
                  Remover
                  <span className="sr-only"> o contato {index + 1}</span>
                </Button>
              </div>
            </fieldset>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Condicoes e observacoes" headingLevel={2} />
        <CardBody className="space-y-4">
          <FormField
            id="supplier-terms"
            label="Condicoes comerciais"
            hint="Texto livre: prazo de pagamento combinado, pedido minimo, frete."
          >
            {(props) => (
              <Textarea
                {...props}
                name="commercialTerms"
                rows={3}
                maxLength={SUPPLIER_TERMS_MAX}
                defaultValue={values?.commercialTerms ?? ''}
              />
            )}
          </FormField>

          <FormField id="supplier-notes" label="Observacoes internas">
            {(props) => (
              <Textarea
                {...props}
                name="notes"
                rows={3}
                maxLength={SUPPLIER_NOTES_MAX}
                defaultValue={values?.notes ?? ''}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
