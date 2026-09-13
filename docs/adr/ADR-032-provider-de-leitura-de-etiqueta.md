# ADR-032 — Leitura de etiqueta atrás de um provider, indisponível por padrão

**Status:** Aceito · **Data:** Prompt 06

## Contexto

Ler marca, modelo, número de série e tensão da foto da etiqueta economiza
digitação e erro no balcão. É um recurso desejável — e depende de um serviço de
OCR/visão externo, contratado e cobrado à parte.

Duas tentações aparecem juntas:

1. Escolher um fornecedor agora e integrar direto no módulo.
2. Entregar "a funcionalidade" com uma implementação improvisada, para mostrar
   a tela pronta.

## Decisão

- O domínio conhece **`EquipmentLabelRecognitionProvider`** — `name`,
  `isAvailable()`, `recognize()` — e nada sobre fornecedor.
- O provider padrão em produção é **`UnavailableRecognitionProvider`**:
  `name = 'none'`, `isAvailable() === false`. Nenhum fornecedor foi escolhido,
  nenhuma credencial existe, nenhuma chamada de rede é feita.
- A interface declara a indisponibilidade em português e **não oferece o botão**
  de fotografar a etiqueta enquanto não houver provider.
- A leitura **nunca é autoridade**: sugere, e quem decide é a pessoa. O valor
  gravado é sempre o confirmado por um humano, e correção humana não é
  sobrescrita depois.
- A tentativa fica em `equipment_label_readings`, separada do cadastro.
- Feature `platform.label_recognition`, tipo **OPTIONAL**, dependente de
  `core.equipment`.

## Motivo

**Um provider falso em produção seria pior do que nenhum.** O atendente
confiaria num palpite, gravaria o número de série errado, e o erro só apareceria
na garantia — quando já não dá para saber de onde veio.

Amarrar o módulo a um fornecedor agora fixaria preço, latência e formato de
resposta antes de existir volume para avaliá-los. Com a interface, trocar de
fornecedor é implementar `recognize` noutro arquivo: nenhum service, página ou
teste do módulo muda.

Manter a sugestão **separada** do valor confirmado responde "de onde veio esse
dado" sem poluir `equipment` com uma coluna de procedência por campo — e
permitirá, um dia, medir a qualidade do provider comparando sugerido com
corrigido, em vez de adivinhar.

O tipo OPTIONAL é honesto: todo o módulo funciona sem a leitura. Quando
indisponível, o cadastro é manual e **nada mais muda**.

## Consequências

- Hoje a leitura automática **não funciona**. Isso está escrito na interface, na
  documentação e nos testes — não há promessa pendurada em tela.
- Ligar um provider no futuro é: implementar a interface, fazer `isAvailable()`
  depender da credencial presente, registrá-lo na inicialização e habilitar a
  feature. O botão aparece porque o provider responde que está disponível — não
  porque alguém escreveu isso na tela.
- `recognizeLabel` roda com timeout de 15 s e não deixa exceção escapar: falha
  de provider nunca bloqueia o cadastro.
- **Código de barras não é decodificado.** `RecognizedLabel.barcode` existe no
  contrato para o dia em que houver um decoder; nenhum está embarcado.
- Os testes exercitam o fluxo com um provider falso injetado. Eles provam o
  contrato, a normalização e o caminho de falha — **não** provam que algum OCR
  funciona, porque nenhum está ligado.
