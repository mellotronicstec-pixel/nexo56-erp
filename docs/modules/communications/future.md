# Comunicação — o que ficou de fora, e por quê

Registrar a ausência como decisão, não como esquecimento. Nada abaixo foi
antecipado: cada item pertence a um prompt futuro específico, e implementá-lo
agora teria significado escrever infraestrutura sem o requisito que a
justifica.

## Provedor real (WhatsApp, e-mail, SMS)

Não há contrato, não há credencial, não há chamada de rede. O registro de
provedor devolve `null` em produção — a mensagem falha com
`provider_not_configured`, registrada e pronta para reenvio no dia em que
houver provedor. Construir a integração real sem credencial forneceria um
"funciona" fictício.

## `delivered` e `read`

Só entram como estados **novos e aditivos** quando existir um provedor real
com webhook de confirmação — o que prova o estado, não o que o inventa.

## Portal do cliente (Prompt 17)

O cliente não vê nem responde mensagem por aqui. Uma resposta do cliente por
WhatsApp hoje não tem para onde ir dentro do Nexo56 — vira conversa fora do
sistema, e é assim que fica até o portal existir.

## Motor de regras / automação (Prompt 19)

`registerCommunicationSubscriptions` escuta
`SERVICE_ORDER_CUSTOMER_NOTIFICATION_REQUESTED` e **não envia nada** —
registra um log sem PII. Decidir "por qual canal, com qual texto, se deve
enviar" ao receber um evento é exatamente o trabalho do motor de regras, com a
configurabilidade e o desligamento explícitos que uma automação exige. O ponto
de extensão já está no lugar certo, sem nada escondido atrás dele.

## IA — reescrever, resumir, sugerir texto (Prompt 20)

Nada aqui reescreve, resume ou profissionaliza o texto digitado. O renderizador
de template é substituição literal, nunca geração.

## API pública (Prompt 23)

Nenhuma rota `/api/comunicacao/*` externa existe. Toda criação de mensagem
passa pelas Server Actions autenticadas da própria aplicação.

## Campanha, broadcast, lista de transmissão

Não existe "enviar para todos os clientes de tal filtro". Cada mensagem tem um
destinatário — um contato de um cliente — resolvido do cadastro. Um disparo em
massa é, por definição, outra ferramenta com outra política de consentimento.

## Push notification

Fora de escopo do Prompt 16: o item fala de canal transacional com o cliente
(WhatsApp/e-mail/SMS), não de notificação dentro do próprio aplicativo.

## Anexo além do certificado de garantia

O `kind` de `communication_attachments` tem um único valor hoje
(`warranty_certificate`), com `CHECK` que o garante. Um segundo tipo de anexo
(orçamento em PDF, por exemplo) entra quando aquele módulo tiver um serviço de
leitura autorizado equivalente a `readCertificatePdf` — nunca lendo arquivo
direto por `storage_key`.
