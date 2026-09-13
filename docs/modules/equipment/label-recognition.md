# Leitura automática de etiqueta

## Estado real

**Não há provider configurado. A leitura automática não funciona hoje.**

O provider padrão em produção é `UnavailableRecognitionProvider`:
`name = 'none'`, `isAvailable() === false`. Ele não tenta ler nada — devolve
`status: 'unavailable'` e a frase _"A leitura automática de etiqueta ainda não
está disponível. Preencha os dados manualmente."_

A interface de cadastro diz isso em texto e **não exibe botão de fotografar a
etiqueta** enquanto não houver provider. Verificado no E2E contra o build de
produção.

O que existe, portanto, é: o **contrato**, a **normalização**, o **fluxo de
confirmação humana**, o **caminho de falha** e a **persistência da tentativa**.
O que não existe é integração com OpenAI, Google, AWS ou qualquer outro
fornecedor — nenhuma credencial, nenhuma chamada de rede, nenhum SDK.

Um provider falso que "reconhecesse" dados em produção seria pior do que
nenhum: o atendente confiaria num palpite.

**Código de barras também não é decodificado.** `RecognizedLabel.barcode` existe
no contrato para o dia em que houver um decoder; nenhum decoder está embarcado.

## A regra que não muda

**A leitura automática nunca é autoridade.** Ela sugere; quem decide é a pessoa.

- O valor persistido em `equipment` é sempre o **confirmado por um humano**.
- Uma correção humana jamais é sobrescrita por uma leitura posterior.
- `equipment_label_readings` guarda o que foi _sugerido_, separado do que foi
  _gravado_. Se o atendente corrigir, o equipamento fica com o valor corrigido e
  a leitura preserva a sugestão — o que permitirá, um dia, medir a qualidade do
  provider sem adivinhar.

Essa separação também evita poluir `equipment` com uma coluna de procedência por
campo.

## Contrato

```ts
interface EquipmentLabelRecognitionProvider {
  readonly name: string;
  isAvailable(): boolean;
  recognize(input: { image: Buffer; mimeType: string }): Promise<RecognitionResult>;
}
```

Campos possíveis (`RecognizedLabel`): `brand`, `model`, `serial`, `voltage`,
`partNumber`, `barcode` — cada um com `value` e `confidence`
(`high | medium | low`).

`RecognitionStatus`: `succeeded | partial | failed | unavailable`.

O domínio conhece essa interface e mais nada. Trocar de fornecedor é implementar
`recognize` noutro arquivo: nenhum service, página ou teste do módulo muda.

## Como ligar um provider no futuro

1. Implementar `EquipmentLabelRecognitionProvider` num arquivo novo, com
   `isAvailable()` respondendo `true` **apenas** quando a credencial estiver
   presente na configuração.
2. Registrá-lo na inicialização (o mesmo ponto onde
   `setLabelRecognitionProviderForTesting` injeta o falso nos testes).
3. Habilitar a feature `platform.label_recognition` no plano e no tenant. Ela
   depende de `core.equipment`.
4. Nada mais. A interface passa a oferecer o botão porque o provider responde
   que está disponível — não porque alguém escreveu isso na tela.

## Falha nunca bloqueia

`recognizeLabel` roda com `Promise.race` contra um timeout de **15 s**
(`RECOGNITION_TIMEOUT_MS`) e não deixa exceção escapar: o pior caso é
`status: 'failed'` com uma frase que a pessoa entende e o cadastro manual
seguindo normalmente.

## Normalização

`normalizeRecognition` limpa espaços, uniformiza o serial e **descarta campo
vazio** — sugerir campo em branco com ar de resultado é pior do que não sugerir
nada; nunca se inventa valor ausente. Com nenhum campo útil, `succeeded` viraria
mentira: o status cai para `failed`; com alguns, `partial`.

### `parseVoltage` e o caso que queima aparelho

Uma etiqueta "110/220V" **contém** "220V". Testar `220` antes de `bivolt`
classificaria um aparelho bivolt como 220 V — exatamente o engano que queima o
equipamento do cliente. Por isso `bivolt` é testado primeiro, e seu padrão
cobre `bivolt`, `100-240`, `110/220` e `127/220`.

Houve um defeito real aqui: `\b220\b` não casa em `110/220V`, porque entre `0` e
`V` não existe borda de palavra. O padrão foi corrigido e o caso está fixado em
teste unitário.

## Observabilidade sem PII

O log registra operação, provider, status, duração e tamanho da imagem. **A
imagem e o conteúdo lido não vão para o log.**

## Testes

`tests/integration/label-recognition.test.ts` (11 casos) exercita o contrato com
um **provider falso injetado**: sucesso, parcial, vazio, exceção, timeout,
confirmação humana e não sobrescrita. Isso testa o fluxo — **não** prova que
algum OCR funciona, porque nenhum está ligado.
