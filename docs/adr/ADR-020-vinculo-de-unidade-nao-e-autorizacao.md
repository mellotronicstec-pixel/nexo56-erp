# ADR-020 — Vínculo de unidade não é autorização

**Status:** Aceito · **Data:** Prompt 03

## Contexto

É o erro clássico de ERP multiempresa: dar acesso à filial acaba dando poder na
filial. O caminho fácil é tratar `user_units` como se fosse permissão — "está
vinculado à Unidade Norte, então pode operar na Unidade Norte" — e o sistema
parece funcionar até o dia em que alguém precisa apenas **consultar** o
estoque de outra filial e recebe junto o direito de mexer nele.

## Decisão

Vínculo e autorização são conceitos **separados**, respondendo perguntas
diferentes:

```
user_units  → ONDE a pessoa pode operar        (membership)
user_roles  → O QUE a pessoa pode fazer        (autorização)
```

Consequências diretas, aplicadas no código:

1. Estar vinculado a uma unidade concede **zero** capacidades. Sem papel, a
   pessoa entra, vê a unidade no seletor e não pode fazer nada nela.
2. Um papel de escopo TENANT **não** concede vínculo a unidades novas. Ampliar
   alcance geográfico continua sendo um ato explícito e auditado.
3. Um papel de escopo UNIT **exige** vínculo prévio naquela unidade — regra
   imposta pelo próprio banco, por foreign key.
4. Remover o vínculo remove as atribuições de papel naquela unidade. A
   aplicação faz isso explicitamente e audita o que saiu; o `ON DELETE CASCADE`
   da FK é a última linha de defesa contra atribuição órfã.

## Motivo

Separar os dois conceitos é o que permite expressar as duas frases que uma
assistência real diz o tempo todo:

- "acessa as duas filiais, mas só consulta" — vínculo amplo, papel fraco;
- "só a filial Norte, e lá faz tudo" — vínculo estreito, papel forte.

Um modelo que junta as duas coisas não consegue expressar nenhuma das duas sem
distorção.

A regra 3 poderia viver só na aplicação. Colocá-la no banco, como FK
`(user_id, unit_id) → user_units`, faz com que nem um `INSERT` direto em SQL,
nem um bug futuro em serviço novo, consigam criar um papel de unidade sem
vínculo — a mesma filosofia do ADR-018.

## Alternativas descartadas

| Alternativa                                 | Por que não                                                 |
| ------------------------------------------- | ----------------------------------------------------------- |
| Vínculo concede papel padrão na unidade     | reintroduz exatamente o acoplamento que a decisão evita     |
| Papel TENANT vincula automaticamente a tudo | ampliação silenciosa de alcance; auditoria perde o "quando" |
| Regra de membership só na aplicação         | um serviço novo esquece; o banco não esquece                |
| Permitir papel de unidade sem vínculo       | criaria acesso a unidade que a pessoa não deveria nem ver   |

## Consequências

- Conceder acesso a alguém exige **dois** atos conscientes: vincular e atribuir
  perfil. É mais trabalho, e é o trabalho certo — cada um auditado em separado.
- A interface precisa explicar a diferença, porque ela não é óbvia. A ficha de
  acesso mostra as duas listas separadas, com os rótulos em português.
- Remover o vínculo tem efeito colateral visível (perde os papéis daquela
  unidade); a interface avisa antes de confirmar.
