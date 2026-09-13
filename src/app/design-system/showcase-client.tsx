'use client';

import { useState } from 'react';
import {
  Button,
  Drawer,
  IconButton,
  Menu,
  MenuHeader,
  MenuItem,
  MenuSeparator,
  MENU_ROW,
  Modal,
  Tooltip,
  ToastProvider,
  useToast,
} from '@/design-system/components';
import { IconMore, IconInfo } from '@/design-system/icons';

/**
 * Parte interativa da vitrine (Prompt 04, item 82).
 *
 * Fica isolada em Client Component para que a pagina da vitrine continue
 * sendo Server Component — a mesma regra que vale para as telas do produto
 * (itens 75 e 76): vira cliente so o pedaco que precisa de estado.
 */

function ToastButtons() {
  const toast = useToast();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          toast({
            tone: 'success',
            title: 'Perfil salvo',
            description: 'As permissoes foram atualizadas.',
          })
        }
      >
        Aviso de sucesso
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          toast({
            tone: 'info',
            title: 'Unidade trocada',
            description: 'Voce esta operando na Unidade Norte.',
          })
        }
      >
        Aviso informativo
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => toast({ tone: 'warning', title: 'Perfil sem permissoes' })}
      >
        Aviso de atencao
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          toast({
            tone: 'error',
            title: 'Nao foi possivel salvar',
            description: 'Este aviso NAO some sozinho — erro critico nunca depende so de toast.',
          })
        }
      >
        Aviso de erro
      </Button>
    </div>
  );
}

export function ShowcaseClient() {
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <ToastProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            Abrir modal
          </Button>

          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
            Acao destrutiva
          </Button>

          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Abrir gaveta
          </Button>

          <Menu
            label="Acoes do exemplo"
            trigger={() => (
              <span className="inline-flex size-10 items-center justify-center rounded-md border border-ink-300 bg-white text-ink-700">
                <IconMore />
              </span>
            )}
          >
            <MenuHeader>
              <p className="text-ui font-semibold text-ink-900">Ana Ribeiro</p>
              <p className="text-small text-ink-500">ana@exemplo.invalid</p>
            </MenuHeader>
            <MenuItem>
              <button type="button" className={MENU_ROW}>
                Ver ficha de acesso
              </button>
            </MenuItem>
            <MenuItem>
              <button type="button" className={MENU_ROW}>
                Gerar codigo de redefinicao
              </button>
            </MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger">
              <button type="button" className={`${MENU_ROW} text-danger-700 hover:bg-danger-50`}>
                Inativar usuario
              </button>
            </MenuItem>
          </Menu>

          <Tooltip content="A dica aparece no hover E no foco pelo teclado.">
            <IconButton label="Ajuda" variant="secondary">
              <IconInfo />
            </IconButton>
          </Tooltip>
        </div>

        <ToastButtons />

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Exemplo de dialogo"
          description="Esc fecha, clique fora fecha, e o foco nao escapa daqui."
          footer={
            <>
              <Button variant="secondary" onClick={() => setModalOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => setModalOpen(false)}>Confirmar</Button>
            </>
          }
        >
          <p>
            Use Tab para percorrer os controles: a navegacao circula dentro do dialogo. Ao fechar, o
            foco volta para o botao que abriu.
          </p>
        </Modal>

        <Modal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title="Inativar este usuario?"
          description="A pessoa perde o acesso imediatamente e as sessoes ativas sao encerradas. O registro e preservado."
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                Manter ativo
              </Button>
              <Button variant="destructive" onClick={() => setConfirmOpen(false)}>
                Inativar
              </Button>
            </>
          }
        >
          <p>
            Acao destrutiva pede confirmacao com o efeito descrito em portugues — nunca um &quot;Tem
            certeza?&quot; solto (item 59).
          </p>
        </Modal>

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Filtros"
          side="right"
          footer={
            <Button fullWidth onClick={() => setDrawerOpen(false)}>
              Aplicar
            </Button>
          }
        >
          <div className="space-y-3 p-4 text-ui text-ink-700">
            <p>
              No celular os filtros vivem em gaveta, para nao empurrar a lista para fora da tela.
            </p>
          </div>
        </Drawer>
      </div>
    </ToastProvider>
  );
}
