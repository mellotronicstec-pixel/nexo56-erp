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
  FormField,
  Input,
  Select,
  Textarea,
} from '@/design-system/components';
import {
  SUGGESTED_EQUIPMENT_KINDS,
  VOLTAGES,
  VOLTAGE_LABEL,
  type Voltage,
} from '@/modules/equipment/domain/equipment';
import { EMPTY_EQUIPMENT_STATE, type EquipmentActionState } from './action-state';
import { LabelCapture, type RecognizedFields } from './label-capture';

/**
 * Formulario de equipamento (Prompt 06, itens 9, 34, 38 e 96).
 *
 * NADA ALEM DO TIPO E OBRIGATORIO. Etiqueta arrancada, ilegivel ou ausente e
 * rotina numa assistencia: exigir marca, modelo ou numero de serie impediria o
 * atendimento justamente nos casos mais comuns.
 *
 * A leitura automatica da etiqueta e um ATALHO opcional (item 96): todos os
 * campos continuam digitaveis, e a captura so preenche o formulario depois de
 * a pessoa revisar e aceitar.
 */

export interface EquipmentFormValues {
  equipmentId?: string;
  customerId: string;
  kind: string;
  brand: string;
  model: string;
  serial: string;
  voltage: Voltage;
  notes: string;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {pending ? 'Salvando...' : label}
    </Button>
  );
}

export function EquipmentForm({
  action,
  initial,
  customerName,
  submitLabel,
  cancelHref,
  labelRecognitionAvailable,
}: {
  action: (previous: EquipmentActionState, formData: FormData) => Promise<EquipmentActionState>;
  initial: EquipmentFormValues;
  customerName: string;
  submitLabel: string;
  cancelHref: string;
  labelRecognitionAvailable: boolean;
}) {
  const [state, formAction] = useActionState(action, EMPTY_EQUIPMENT_STATE);

  /**
   * Campos controlados para que a leitura da etiqueta consiga preenche-los.
   * Sem isso, aceitar uma sugestao exigiria recarregar a pagina.
   */
  const [brand, setBrand] = useState(initial.brand);
  const [model, setModel] = useState(initial.model);
  const [serial, setSerial] = useState(initial.serial);
  const [voltage, setVoltage] = useState<Voltage>(initial.voltage);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="customerId" value={initial.customerId} />
      {initial.equipmentId ? (
        <input type="hidden" name="equipmentId" value={initial.equipmentId} />
      ) : null}

      {state.error ? (
        <Alert tone={state.similar.length > 0 ? 'warning' : 'danger'} title={state.error}>
          {state.similar.length > 0 ? (
            <>
              <ul className="mt-2 space-y-1">
                {state.similar.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/equipamentos/${item.id}`}
                      className="font-semibold text-brand-700 underline"
                    >
                      {item.title}
                    </Link>{' '}
                    <span className="text-ink-600">· {item.customerName}</span>
                  </li>
                ))}
              </ul>
              {/*
                Reenviar com este campo confirma que e outro aparelho mesmo.
                O aviso nunca vira bloqueio (item 55).
              */}
              <input type="hidden" name="confirmarDuplicado" value="sim" />
              <p className="mt-2 text-small">
                Se for mesmo um equipamento diferente, envie novamente para confirmar.
              </p>
            </>
          ) : null}
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Identificacao"
          description={`Equipamento de ${customerName}. Apenas o tipo e obrigatorio.`}
        />
        <CardBody className="space-y-4">
          <LabelCapture
            available={labelRecognitionAvailable}
            onAccept={(fields: RecognizedFields) => {
              if (fields.brand) setBrand(fields.brand);
              if (fields.model) setModel(fields.model);
              if (fields.serial) setSerial(fields.serial);
              if (fields.voltage) setVoltage(fields.voltage);
            }}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="kind" label="Tipo de equipamento" required>
              {(props) => (
                <>
                  <Input
                    {...props}
                    name="kind"
                    defaultValue={initial.kind}
                    list="tipos-equipamento"
                    required
                    placeholder="TV, amplificador, micro-ondas..."
                  />
                  {/* Sugestoes, nao lista fechada: a assistencia sempre recebe
                      algo que ninguem previu (item 10). */}
                  <datalist id="tipos-equipamento">
                    {SUGGESTED_EQUIPMENT_KINDS.map((kind) => (
                      <option key={kind} value={kind} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>

            <FormField id="brand" label="Marca">
              {(props) => (
                <Input
                  {...props}
                  name="brand"
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                  placeholder="Samsung, LG, Yamaha..."
                />
              )}
            </FormField>

            <FormField id="model" label="Modelo">
              {(props) => (
                <Input
                  {...props}
                  name="model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="RX-V385"
                />
              )}
            </FormField>

            <FormField
              id="serial"
              label="Numero de serie"
              hint="Opcional. Etiqueta ilegivel ou ausente nao impede o cadastro."
            >
              {(props) => (
                <Input
                  {...props}
                  name="serial"
                  value={serial}
                  onChange={(event) => setSerial(event.target.value)}
                />
              )}
            </FormField>

            <FormField id="voltage" label="Tensao" hint="Na duvida, deixe como nao identificada.">
              {(props) => (
                <Select
                  {...props}
                  name="voltage"
                  value={voltage}
                  onChange={(event) => setVoltage(event.target.value as Voltage)}
                >
                  {VOLTAGES.map((option) => (
                    <option key={option} value={option}>
                      {VOLTAGE_LABEL[option]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>

            <FormField
              id="notes"
              label="Observacoes de identificacao"
              className="sm:col-span-2"
              hint="Detalhes que ajudam a reconhecer o aparelho. Diagnostico tecnico nao entra aqui."
            >
              {(props) => <Textarea {...props} name="notes" defaultValue={initial.notes} />}
            </FormField>
          </div>
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
    </form>
  );
}
