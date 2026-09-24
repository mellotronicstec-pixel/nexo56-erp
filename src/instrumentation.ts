/**
 * Ponto de inicializacao do servidor (Next.js `instrumentation`).
 *
 * Roda UMA vez por processo, antes de atender pedido. E aqui que os modulos
 * que ESCUTAM eventos se inscrevem — sem isso, a inscricao dependeria de
 * alguem ter importado o modulo por acaso, e um evento passaria despercebido
 * dependendo de qual pagina o usuario abriu primeiro.
 *
 * A checagem de runtime existe porque o `edge` nao tem `server-only` nem
 * acesso ao banco: as inscricoes sao do runtime Node.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { registerCommunicationSubscriptions } =
    await import('@/modules/communications/application/subscriptions');
  registerCommunicationSubscriptions();

  const { registerAutomationSubscriptions } =
    await import('@/modules/automations/application/subscriptions');
  registerAutomationSubscriptions();
}
