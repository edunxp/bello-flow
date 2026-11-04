# Bootstrap administrativo

## Escopo e credencial

Este procedimento cria exclusivamente o primeiro Administrador Global e permite
reconciliar uma tentativa pelo `operation_id`. Ele não é recuperação emergencial
e não deve ser incorporado ao processo HTTP da API.

A CLI usa somente `BOOTSTRAP_DATABASE_URL`. Não configure `DATABASE_URL`,
`MIGRATION_DATABASE_URL` ou credenciais de manutenção como substitutas. Proteja a
URL contra histórico de shell, logs e listagens de processos conforme o mecanismo
de secrets do ambiente.

Execute localmente, a partir de um terminal administrativo confiável. A criação
exige TTY porque a senha e sua confirmação são lidas sem eco ou máscara. A senha
não pode ser passada por argumento ou variável de ambiente.

## Instalação no Oracle Linux 8.10

O projeto fixa `argon2@0.44.0`. Os binários Linux publicados pelo pacote são
construídos para Ubuntu 22.04; não se presume compatibilidade com a glibc 2.28 do
Oracle Linux 8.10. O Node.js 24 gera o build nativo com `-std=gnu++20`, portanto a
instalação reproduzível no alvo usa o GCC Toolset 12, em vez do GCC 8 do sistema,
e compila o módulo localmente:

```bash
sudo dnf install -y gcc-toolset-12 make python3.12
scl enable gcc-toolset-12 bash

gcc --version
g++ --version
python3.12 --version
node --version
npm --version

export NODE_GYP_FORCE_PYTHON=/usr/bin/python3.12
export npm_config_build_from_source=true
npm ci

test -f apps/api/node_modules/argon2/build/Release/argon2.node
npm exec --workspace=@bello/api -- node -e \
  "require('argon2'); console.log('argon2 native addon: ok')"
npm run quality:local
```

O `scl enable` abre um shell no qual o GCC 12 tem precedência; confirme que ambos
os comandos de versão do compilador informam a série 12 antes de executar o
`npm ci`. O Python deve ser explicitamente o `3.12`: no Oracle Linux 8.10, o
comando genérico `python3` continua apontando por padrão para o Python 3.6. Não
altere a alternativa global do sistema.

Com o npm distribuído com o Node.js aprovado, `npm ci --build-from-source` ainda
propaga `npm_config_build_from_source=true` aos scripts de instalação, mas o npm
11 avisa que a opção de linha de comando é uma configuração desconhecida. A
variável explícita acima é o contrato reconhecido por `node-gyp-build@4.8.4` e
evita depender desse encaminhamento. O teste do arquivo comprova que houve build
local; o comando seguinte comprova que o addon nativo pode ser carregado.

O Node.js usado para instalar e executar deve informar exatamente `v24.22.2`, e o
npm, `11.19.1`. A imagem ou host de destino precisa repetir o build nativo; não
copie o diretório `node_modules` de outra distribuição ou de outro host. Como
confirmação adicional de compatibilidade, inspecione no alvo as versões
`GLIBC_*` requeridas por
`apps/api/node_modules/argon2/build/Release/argon2.node` com
`readelf --version-info`: nenhuma pode ser superior à glibc 2.28 do Oracle Linux
8.10.
Essa validação do artefato no próprio Oracle Linux continua sendo evidência
operacional exigida por PT-001; a versão de Argon2 não deve ser alterada sem nova
decisão.

## Criação inicial

Com as dependências instaladas e `BOOTSTRAP_DATABASE_URL` fornecida por meio
seguro:

```bash
npm run build --workspace=@bello/api
npm run bootstrap:admin --workspace=@bello/api
```

A CLI solicita nome, sobrenome, e-mail, referências operacionais, senha e
confirmação. Antes do envio, apresenta somente dados não secretos e exige a
confirmação literal `CONFIRMAR`. A função PostgreSQL é executada uma única vez;
não existe retry automático.

Guarde o `operation_id` exibido. Se houver falha depois do possível envio, não
presuma sucesso nem rollback e não repita a criação.

## Reconciliação

A reconciliação não solicita senha, não gera hash ou UUID, não chama
`bootstrap_initial_admin` e não executa DML:

```bash
npm run bootstrap:admin --workspace=@bello/api -- \
  reconcile <operation_id-uuid-v4>
```

Resultados:

| Resultado           | Significado                                                                                                                            | Exit code |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| `COMPLETED`         | A tentativa consultada criou o Administrador Global e as evidências acessíveis são consistentes.                                       |       `0` |
| `ALREADY_COMPLETED` | Outro `operation_id` concluiu o bootstrap consistentemente. A tentativa consultada não criou o administrador.                          |       `0` |
| `INCONSISTENT`      | Estado, conta, credencial, papel ou auditoria acessível são contraditórios.                                                            |       `2` |
| `UNKNOWN`           | A consulta falhou, excedeu o limite ou encontrou `bootstrap_state` em `PENDING`, pois não é possível excluir uma operação concorrente. |       `2` |

Entrada inválida, cancelamento e erros funcionais usam exit code `1`. Código `0`
indica que o comando solicitado terminou sem erro operacional pendente; para
reconciliação ele não torna `ALREADY_COMPLETED` equivalente a `COMPLETED`.

Se a leitura confirmar um resultado, mas o fechamento da conexão ou do contexto
falhar, a evidência é exibida e o processo retorna código diferente de zero.

## Evidências e limites

A role de bootstrap pode ler somente:

- estado, conta inicial e operação em `bootstrap_state`;
- `account.id`;
- `password_credential.account_id` e `changed_operation_id`;
- `global_role_assignment.account_id` e `role`;
- `audit_event.id`, `result`, `entity_type`, `entity_id`, `operation_id` e
  `sequence`.

A consulta correlaciona o singleton concluído, a conta inicial, a credencial cuja
última alteração aponta para a operação do bootstrap, o papel `GLOBAL_ADMIN` e
exatamente dois eventos bem-sucedidos nas sequências `1` e `2`. Ela não lê
`password_hash`. A coluna `audit_event.operation` não está concedida à role;
portanto, os nomes textuais `ACCOUNT_CREATED` e `GLOBAL_ADMIN_GRANTED` não são
relidos. A correlação usa as sequências e os demais campos não secretos aprovados,
sem ampliar privilégios.

A leitura usa um único `SELECT` com snapshot consistente e não solicita row locks.
Um estado `PENDING` é sempre `UNKNOWN`, mesmo sem outras evidências visíveis,
porque os privilégios existentes não permitem provar formalmente a ausência de
uma execução concorrente. O limite de statement é de cinco segundos e não há
polling ou retry automático.

PT-017 recebe com esta etapa evidência implementada de interface, autorização e
reconciliação, mas sua situação documental só deve ser alterada após revisão e
aprovação. PT-018 permanece integralmente aberta e fora deste procedimento.
