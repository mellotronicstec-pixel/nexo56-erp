# ADR-022 — Ciclo de vida da sessão e revogação

**Status:** Aceito · **Data:** Prompt 03

## Contexto

O [ADR-006](ADR-006-autenticacao-e-sessoes.md) definiu a sessão server-side:
token opaco no cookie, só o SHA-256 no banco, expiração por TTL. Faltava
responder o resto do ciclo de vida — o que acontece com as sessões quando a
senha muda, quando a conta é desativada, quando a pessoa quer encerrar o acesso
de um celular perdido, quando um administrador precisa cortar o acesso de
alguém agora.

Sem essas respostas, "revogar acesso" na prática significa esperar o TTL. Doze
horas é tempo demais quando alguém foi desligado.

## Decisão

Revogar é sempre **gravar `revoked_at`**, nunca apagar a linha. A validação
exige, na mesma consulta, `revoked_at IS NULL AND expires_at > agora`.

Os gatilhos de revogação:

| Evento                                  | Alcance                       |
| --------------------------------------- | ----------------------------- |
| Logout                                  | a sessão atual                |
| "Encerrar esta sessão" (`/minha-conta`) | a sessão escolhida            |
| "Encerrar as outras"                    | todas menos a atual           |
| Troca de senha                          | todas menos a atual (padrão)  |
| Redefinição de senha concluída          | **todas**, sem exceção        |
| Administrador com `sessions.revoke`     | todas as do usuário alvo      |
| Usuário desativado                      | todas, na mesma transação     |
| Expiração (TTL)                         | deixa de validar, sem escrita |

A diferença entre troca e redefinição é proposital: quem troca a senha sabendo
a atual está autenticado e pode manter a sessão de onde está operando. Quem
redefine por token pode estar retomando uma conta comprometida — nesse caso
**toda** sessão existente é suspeita, inclusive a de quem está redefinindo.

O token de redefinição segue o mesmo modelo do token de sessão: 256 bits de
CSPRNG, só o SHA-256 no banco, uso único (`used_at`), validade de 60 minutos.

`user_agent_summary` guarda um resumo curto ("Chrome no Windows"), truncado em
120 caracteres, com um propósito único: a pessoa reconhecer o próprio
dispositivo na lista. **IP não é gravado** e o user-agent completo não é
gravado — não é fingerprint.

## Motivo

Marcar em vez de apagar preserva a trilha de quem entrou, quando e de onde
saiu — informação que a auditoria precisa e que um `DELETE` destruiria.

Revogar todas as sessões na redefinição é a única escolha defensável: se o
token existe porque a conta foi comprometida, manter qualquer sessão viva anula
a redefinição.

Guardar o resumo do agente é o mínimo que torna a lista de sessões acionável.
Sem ele, a tela mostra "sessão de 12/09 às 14h" e a pessoa não tem como decidir
qual encerrar. Guardar IP e user-agent completo tornaria a lista um histórico
de localização — dado pessoal que o produto não precisa (LGPD, Prompt 00
item 92).

## Alternativas descartadas

| Alternativa                      | Por que não                                                |
| -------------------------------- | ---------------------------------------------------------- |
| JWT sem estado                   | não há como revogar antes da expiração; o problema central |
| `DELETE` na revogação            | destrói a trilha de auditoria                              |
| Revogação só por TTL             | doze horas de acesso após o desligamento                   |
| Manter sessões após redefinição  | anula a redefinição se a conta estava comprometida         |
| Gravar IP e user-agent completos | histórico de localização sem necessidade de produto (LGPD) |
| Lista de bloqueio em memória     | some no restart; não funciona com mais de um processo      |

## Consequências

- Revogação é imediata e verificável no backend — há teste de integração para
  cada gatilho da tabela acima.
- A tabela `sessions` cresce: a limpeza de sessões expiradas é um job em
  background, idempotente, já existente desde o Prompt 01.
- Trocar a senha derruba os outros dispositivos por padrão. A interface deixa a
  opção visível e explica o efeito, em vez de fazer isso em silêncio.
- **Não há autoatendimento de "esqueci minha senha"**: nenhum serviço de e-mail
  está configurado no projeto. O código de redefinição é gerado por um
  administrador e entregue pessoalmente. O autoatendimento é uma adição futura
  que não muda este modelo — só acrescenta um canal de entrega.
