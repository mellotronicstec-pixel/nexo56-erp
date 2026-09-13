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
import {
  INSPECTION_CONDITIONS,
  POWER_CABLE_ANSWERS,
  POWER_CABLE_LABEL,
  SUGGESTED_ACCESSORIES,
} from '@/modules/equipment/domain/equipment';
import { EMPTY_EQUIPMENT_STATE, type EquipmentActionState } from '../equipamentos/action-state';

/**
 * Recebimento no balcao (Prompt 06, itens 82 a 85).
 *
 * SECOES PROGRESSIVAS, NAO UM FORMULARIO GIGANTE: identificacao ja resolvida
 * antes de chegar aqui, depois acessorios, estado fisico e observacoes. O
 * atendente com o cliente na frente precisa terminar rapido — por isso nada
 * alem do equipamento e obrigatorio.
 *
 * O checklist e touch-friendly: cada condicao e um rotulo inteiro clicavel,
 * nao uma caixinha de 12px.
 */

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" loading={pending}>
      {pending ? 'Registrando...' : 'Confirmar recebimento'}
    </Button>
  );
}

export function IntakeForm({
  action,
  equipmentId,
  equipmentTitle: title,
  customerName,
  unitName,
  cancelHref,
}: {
  action: (previous: EquipmentActionState, formData: FormData) => Promise<EquipmentActionState>;
  equipmentId: string;
  equipmentTitle: string;
  customerName: string;
  unitName: string;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_EQUIPMENT_STATE);
  const [accessories, setAccessories] = useState<{ label: string; quantity: number }[]>([]);

  const addAccessory = (label = '') =>
    setAccessories((current) => [...current, { label, quantity: 1 }]);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="equipmentId" value={equipmentId} />

      {state.error ? <Alert tone="danger">{state.error}</Alert> : null}

      <Card>
        <CardHeader title="Equipamento recebido" description={`${title} · ${customerName}`} />
        <CardBody className="space-y-4">
          {/* A unidade vem do contexto e e so informativa aqui: o servidor nao
              aceita unidade vinda do formulario. */}
          <Alert tone="info">
            Este recebimento sera registrado na unidade <strong>{unitName}</strong>.
          </Alert>

          <FormField id="powerCable" label="Cabo de forca entregue?">
            {(props) => (
              <Select {...props} name="powerCable" defaultValue="not_applicable">
                {POWER_CABLE_ANSWERS.map((answer) => (
                  <option key={answer} value={answer}>
                    {POWER_CABLE_LABEL[answer]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </CardBody>
      </Card>

      <Section
        id="acessorios"
        title="Acessorios entregues"
        description="O que veio junto com o aparelho."
        actions={
          <Button type="button" variant="secondary" size="sm" onClick={() => addAccessory()}>
            <IconPlus size={16} />
            Adicionar
          </Button>
        }
      >
        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_ACCESSORIES.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addAccessory(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>

            {accessories.length === 0 ? (
              <p className="text-small text-ink-500">
                Nenhum acessorio registrado. Toque numa sugestao ou use &quot;Adicionar&quot;.
              </p>
            ) : (
              <ul className="space-y-2">
                {accessories.map((accessory, index) => (
                  <li key={index} className="flex items-end gap-2">
                    <FormField
                      id={`accessory-${index}`}
                      label={`Acessorio ${index + 1}`}
                      className="flex-1"
                    >
                      {(props) => (
                        <Input
                          {...props}
                          name="accessoryLabel"
                          value={accessory.label}
                          onChange={(event) =>
                            setAccessories((current) =>
                              current.map((item, position) =>
                                position === index ? { ...item, label: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Controle remoto, fonte..."
                        />
                      )}
                    </FormField>

                    <FormField id={`accessory-qty-${index}`} label="Qtd" className="w-20">
                      {(props) => (
                        <Input
                          {...props}
                          name="accessoryQuantity"
                          type="number"
                          min={1}
                          max={999}
                          inputMode="numeric"
                          value={accessory.quantity}
                          onChange={(event) =>
                            setAccessories((current) =>
                              current.map((item, position) =>
                                position === index
                                  ? { ...item, quantity: Number(event.target.value) || 1 }
                                  : item,
                              ),
                            )
                          }
                        />
                      )}
                    </FormField>

                    <IconButton
                      label={`Remover acessorio ${index + 1}`}
                      variant="destructive"
                      onClick={() =>
                        setAccessories((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                    >
                      <IconClose size={18} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </Section>

      <Section
        id="inspecao"
        title="Estado na entrada"
        description="Como o aparelho chegou. Isto NAO e diagnostico tecnico."
      >
        <Card>
          <CardBody className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {INSPECTION_CONDITIONS.map((condition) => (
                <Checkbox
                  key={condition.key}
                  name="condition"
                  value={condition.key}
                  label={condition.label}
                />
              ))}
            </div>

            {/* O checklist acelera, mas nao limita (item 19). */}
            <FormField
              id="inspectionNotes"
              label="Outras observacoes sobre o estado fisico"
              hint="Para o que o checklist nao previu."
            >
              {(props) => <Textarea {...props} name="inspectionNotes" rows={3} />}
            </FormField>
          </CardBody>
        </Card>
      </Section>

      <Card>
        <CardHeader title="Observacoes do atendimento" headingLevel={2} />
        <CardBody>
          <FormField
            id="notes"
            label="Observacoes gerais"
            hint="O relato do cliente sobre o problema entra na Ordem de Servico, nao aqui."
          >
            {(props) => <Textarea {...props} name="notes" rows={3} />}
          </FormField>
        </CardBody>
        <CardFooter>
          <Link
            href={cancelHref}
            className="inline-flex h-10 items-center justify-center rounded-md border border-ink-300 bg-white px-4 text-ui font-semibold text-ink-700 transition-colors hover:bg-ink-50"
          >
            Cancelar
          </Link>
          <SubmitButton />
        </CardFooter>
      </Card>
    </form>
  );
}
