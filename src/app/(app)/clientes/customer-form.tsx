'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  FormField,
  IconButton,
  Input,
  Section,
  Select,
  Textarea,
} from '@/design-system/components';
import { IconClose, IconPlus } from '@/design-system/icons';
import type { CustomerKind } from '@/modules/customers/domain/customer';
import { EMPTY_CUSTOMER_STATE, type CustomerActionState } from './action-state';

/**
 * Formulario de cliente (Prompt 05, itens 6, 7, 29, 30, 32 e 47).
 *
 * CADASTRO RAPIDO SEM PERDER O COMPLETO (item 30)
 *
 * A primeira secao tem o minimo para atender alguem no balcao: tipo, nome e
 * um contato. Tudo que enriquece o cadastro — documento, endereco, mais
 * contatos, observacoes — fica abaixo, visivel e opcional. Nada essencial foi
 * escondido atras de um "avancado" (item 30).
 *
 * Os campos mudam conforme PF ou PJ (item 7): quem cadastra uma pessoa nao ve
 * inscricao estadual, e quem cadastra uma empresa nao ve data de nascimento.
 */

export interface CustomerFormValues {
  customerId?: string;
  kind: CustomerKind;
  name: string;
  tradeName: string;
  document: string;
  stateRegistration: string;
  birthDate: string;
  notes: string;
  contacts: { type: 'phone' | 'email'; value: string; label: string; isWhatsapp: boolean }[];
  address: {
    zipCode: string;
    street: string;
    number: string;
    complement: string;
    district: string;
    city: string;
    state: string;
  };
}

export const EMPTY_FORM_VALUES: CustomerFormValues = {
  kind: 'individual',
  name: '',
  tradeName: '',
  document: '',
  stateRegistration: '',
  birthDate: '',
  notes: '',
  contacts: [{ type: 'phone', value: '', label: '', isWhatsapp: true }],
  address: {
    zipCode: '',
    street: '',
    number: '',
    complement: '',
    district: '',
    city: '',
    state: '',
  },
};

/** Botao de envio que se desabilita sozinho — sem duplo cadastro (item 32). */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? 'Salvando...' : label}
    </Button>
  );
}

export function CustomerForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (previous: CustomerActionState, formData: FormData) => Promise<CustomerActionState>;
  initial: CustomerFormValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_CUSTOMER_STATE);
  const [kind, setKind] = useState<CustomerKind>(initial.kind);
  const [contacts, setContacts] = useState(initial.contacts);

  const isCompany = kind === 'company';
  const editing = Boolean(initial.customerId);

  const addContact = () =>
    setContacts((current) => [
      ...current,
      { type: 'phone', value: '', label: '', isWhatsapp: false },
    ]);

  const removeContact = (index: number) =>
    setContacts((current) => current.filter((_, position) => position !== index));

  const updateContact = (index: number, patch: Partial<(typeof contacts)[number]>) =>
    setContacts((current) =>
      current.map((contact, position) => (position === index ? { ...contact, ...patch } : contact)),
    );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {initial.customerId ? (
        <input type="hidden" name="customerId" value={initial.customerId} />
      ) : null}

      {state.error ? (
        <Alert tone="danger" title="Nao foi possivel salvar">
          <p>{state.error}</p>
          {state.duplicate ? (
            <p className="mt-2">
              <Link
                href={`/clientes/${state.duplicate.id}`}
                className="font-semibold text-brand-700 underline"
              >
                Abrir o cadastro de {state.duplicate.name}
              </Link>
            </p>
          ) : null}
        </Alert>
      ) : null}

      {/* ---------------------------------------------- dados principais */}
      <Card>
        <CardHeader
          title="Dados principais"
          description="O minimo para atender agora. O resto pode ser completado depois."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormField id="kind" label="Tipo de cliente" required>
            {(props) => (
              <Select
                {...props}
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as CustomerKind)}
                /**
                 * O tipo nao muda depois de criado (item 33): trocar PF por PJ
                 * trocaria a natureza do documento e o significado do nome.
                 */
                disabled={editing}
              >
                <option value="individual">Pessoa fisica</option>
                <option value="company">Pessoa juridica</option>
              </Select>
            )}
          </FormField>

          <FormField
            id="name"
            label={isCompany ? 'Razao social' : 'Nome completo'}
            required
            hint={editing ? undefined : 'Como consta no documento.'}
          >
            {(props) => (
              <Input
                {...props}
                name="name"
                defaultValue={initial.name}
                autoComplete="off"
                required
              />
            )}
          </FormField>

          {isCompany ? (
            <FormField
              id="tradeName"
              label="Nome fantasia"
              hint="Como a empresa e conhecida no balcao."
            >
              {(props) => <Input {...props} name="tradeName" defaultValue={initial.tradeName} />}
            </FormField>
          ) : null}

          <FormField
            id="document"
            label={isCompany ? 'CNPJ' : 'CPF'}
            hint="Opcional. Pode ser informado depois."
          >
            {(props) => (
              <Input
                {...props}
                name="document"
                defaultValue={initial.document}
                inputMode="numeric"
                placeholder={isCompany ? '00.000.000/0000-00' : '000.000.000-00'}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      {/* ----------------------------------------------------- contatos */}
      <Section
        id="contatos"
        title="Contatos"
        description="Pelo menos um telefone, WhatsApp ou e-mail. O primeiro da lista e o contato principal."
        actions={
          <Button type="button" variant="secondary" size="sm" onClick={addContact}>
            <IconPlus size={16} />
            Adicionar contato
          </Button>
        }
      >
        <Card>
          <CardBody className="space-y-4">
            {contacts.map((contact, index) => (
              <div
                key={index}
                /*
                  A grade so abre em `lg`, nao em `sm`: entre 768px e 1023px a
                  sidebar fixa come 256px da largura, e quatro colunas nao
                  cabem no que sobra — a pagina ganhava rolagem horizontal.
                  `minmax(0,1fr)` impede que o campo do meio se recuse a
                  encolher.
                */
                className="grid gap-3 rounded-md border border-ink-200 p-3 lg:grid-cols-[140px_minmax(0,1fr)_160px_auto] lg:items-end"
              >
                <FormField id={`contact-type-${index}`} label="Tipo">
                  {(props) => (
                    <Select
                      {...props}
                      name="contactType"
                      value={contact.type}
                      onChange={(event) =>
                        updateContact(index, {
                          type: event.target.value as 'phone' | 'email',
                          isWhatsapp: event.target.value === 'phone' ? contact.isWhatsapp : false,
                        })
                      }
                    >
                      <option value="phone">Telefone</option>
                      <option value="email">E-mail</option>
                    </Select>
                  )}
                </FormField>

                <FormField
                  id={`contact-value-${index}`}
                  label={contact.type === 'phone' ? 'Numero' : 'Endereco de e-mail'}
                  required={index === 0}
                >
                  {(props) => (
                    <Input
                      {...props}
                      name="contactValue"
                      value={contact.value}
                      onChange={(event) => updateContact(index, { value: event.target.value })}
                      inputMode={contact.type === 'phone' ? 'tel' : 'email'}
                      placeholder={
                        contact.type === 'phone' ? '(11) 98888-7777' : 'cliente@exemplo.com'
                      }
                    />
                  )}
                </FormField>

                <FormField id={`contact-label-${index}`} label="Rotulo">
                  {(props) => (
                    <Input
                      {...props}
                      name="contactLabel"
                      value={contact.label}
                      onChange={(event) => updateContact(index, { label: event.target.value })}
                      placeholder="Celular, Comercial..."
                    />
                  )}
                </FormField>

                <div className="flex items-center gap-2 sm:pb-2">
                  {/*
                    WhatsApp e uma CARACTERISTICA do numero (item 13), nao um
                    contato separado: um checkbox, nao outra linha.
                  */}
                  {contact.type === 'phone' ? (
                    <>
                      <Checkbox
                        label="WhatsApp"
                        checked={contact.isWhatsapp}
                        onChange={(event) =>
                          updateContact(index, { isWhatsapp: event.target.checked })
                        }
                      />
                      {contact.isWhatsapp ? (
                        <input type="hidden" name="contactWhatsapp" value={index} />
                      ) : null}
                    </>
                  ) : null}

                  {contacts.length > 1 ? (
                    <IconButton
                      label={`Remover contato ${index + 1}`}
                      variant="destructive"
                      size="sm"
                      onClick={() => removeContact(index)}
                    >
                      <IconClose size={16} />
                    </IconButton>
                  ) : null}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </Section>

      {/* ------------------------------------------- dados complementares */}
      <Section
        id="complementares"
        title="Informacoes complementares"
        description="Tudo aqui e opcional e pode ser preenchido em outro momento."
      >
        <Card>
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {isCompany ? (
              <FormField id="stateRegistration" label="Inscricao estadual">
                {(props) => (
                  <Input
                    {...props}
                    name="stateRegistration"
                    defaultValue={initial.stateRegistration}
                    placeholder="ISENTO quando nao houver"
                  />
                )}
              </FormField>
            ) : (
              <FormField id="birthDate" label="Data de nascimento">
                {(props) => (
                  <Input {...props} name="birthDate" type="date" defaultValue={initial.birthDate} />
                )}
              </FormField>
            )}

            <FormField
              id="zipCode"
              label="CEP"
              /*
               * Preenchimento automatico por CEP nao existe ainda (item 16):
               * nenhuma integracao foi definida, e prometer o que nao ha e
               * pior do que a digitacao manual. A estrutura esta pronta.
               */
              hint="Preenchimento manual. Busca automatica por CEP ainda nao esta disponivel."
            >
              {(props) => (
                <Input
                  {...props}
                  name="zipCode"
                  defaultValue={initial.address.zipCode}
                  inputMode="numeric"
                  placeholder="00000-000"
                />
              )}
            </FormField>

            <FormField id="street" label="Logradouro">
              {(props) => <Input {...props} name="street" defaultValue={initial.address.street} />}
            </FormField>

            <FormField id="number" label="Numero">
              {(props) => <Input {...props} name="number" defaultValue={initial.address.number} />}
            </FormField>

            <FormField id="complement" label="Complemento">
              {(props) => (
                <Input {...props} name="complement" defaultValue={initial.address.complement} />
              )}
            </FormField>

            <FormField id="district" label="Bairro">
              {(props) => (
                <Input {...props} name="district" defaultValue={initial.address.district} />
              )}
            </FormField>

            <FormField id="city" label="Cidade">
              {(props) => <Input {...props} name="city" defaultValue={initial.address.city} />}
            </FormField>

            <FormField id="state" label="Estado (UF)">
              {(props) => (
                <Input
                  {...props}
                  name="state"
                  defaultValue={initial.address.state}
                  maxLength={2}
                  placeholder="SP"
                />
              )}
            </FormField>

            <FormField
              id="notes"
              label="Observacoes internas"
              className="sm:col-span-2"
              hint="Uso interno da equipe. O cliente nao ve este campo."
            >
              {(props) => <Textarea {...props} name="notes" defaultValue={initial.notes} />}
            </FormField>
          </CardBody>
          <CardFooter>
            <Link
              href={cancelHref}
              className="inline-flex h-10 items-center justify-center rounded-md border border-ink-300 bg-white px-4 text-ui font-semibold text-ink-700 transition-colors hover:bg-ink-50"
            >
              Cancelar
            </Link>
            <SubmitButton label={submitLabel} />
          </CardFooter>
        </Card>
      </Section>
    </form>
  );
}
