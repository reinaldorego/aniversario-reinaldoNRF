# Laboratório Drive — Marco 04B.3B.11

O diagnóstico local do **Marco 04B.3B.18.17** está descrito nas seções 12 e 13. As seções anteriores
são registros históricos de implementação e testes offline; não descrevem o resultado das operações
supervisionadas posteriores informadas pelo responsável. Nesta etapa de diagnóstico não houve leitura
dos arquivos privados reais nem consulta Google.

**Estado:** preparação implementada e testada offline com mocks. Não houve login, chamada Google real, criação de pasta, leitura de fotos ou transferência de mídia. A aprovação desta implementação não autoriza operações reais. Evento: **28/11/2026 às 21h em Belém/PA**.

## 1. Comandos isolados

Executar em `tools/live-experience-local/`:

```powershell
npm.cmd run drive:lab-create
npm.cmd run drive:lab-inspect
npm.cmd run drive:lab-create -- --dry-run
npm.cmd run drive:lab-inspect -- --dry-run
```

Todos retornam `DRY_RUN`, `effects=NONE`, escopo único `drive.file` e necessidade de aprovação humana separada. O retorno precede leitura de configuração privada, credenciais, tokens, aprovação, estado e ACL local, carregamento do SDK, navegador, rede, sockets e escrita. Os módulos importados só definem funções/classes/constantes; não inicializam transporte ou estado.

`src/drive-lab-cli.mjs` é uma CLI nova. A CLI OAuth, o simulador, as 218 verificações anteriores e o motor de publicação não foram alterados. Nenhum comando do laboratório importa motor, fonte editorial ou API do simulador.

Somente uma futura execução com a flag `--execute`, **depois de autorização humana específica**, pode sair do preview. A flag sozinha é insuficiente: também é obrigatório um registro privado válido e consumível de aprovação. Não executar essa flag nesta etapa.

## 2. Configuração futura, sempre externa

| Variável | Uso futuro |
| --- | --- |
| `LEVEL_DRIVE_CREDENTIALS_FILE` | JSON Desktop externo já protegido; mesmo contrato do runbook OAuth. |
| `LEVEL_DRIVE_TOKEN_DIR` | Diretório privado dos tokens OAuth existentes. Nunca é o diretório de estado do laboratório. |
| `LEVEL_DRIVE_LAB_APPROVAL_FILE` | Registro JSON privado da aprovação humana daquela ação. |
| `LEVEL_DRIVE_LAB_STATE_DIR` | Um único diretório privado, novo, dedicado, existente e externo para toda a vida deste laboratório. |

Não criar `.env`, credenciais, manifesto operacional ou estado com IDs reais no repositório. Não usar pastas servidas por HTTP, sincronizadas/compartilhadas ou que contenham dados pessoais. O registro de aprovação deve ficar fora do diretório dedicado de estado; este aceita somente os três nomes fixos de estado/claim/lock. O diretório dos tokens será recusado como estado por conter arquivo alheio ao laboratório.

Reutilizam-se validação de caminhos externos, recusa de junctions/symlinks/hardlinks/UNC/dispositivos e verificação de ACL do 04B.3A. Windows: somente usuário atual, SYSTEM e Administradores locais confiáveis; POSIX: proprietário atual e nenhum acesso de grupo/outros. Não há alteração automática de ACL. Falta de evidência bloqueia.

## 3. Aprovação humana consumível

O registro é produzido e revisado pelo operador **somente após aprovação futura**. Não existe comando que emita uma autorização automaticamente. Esquema ilustrativo deliberadamente inválido, sem IDs ou prazos operacionais:

```json
{
  "kind": "LEVEL_XVIII_DRIVE_LAB_APPROVAL_V1",
  "action": "lab-create",
  "approvalId": "HEX_64_ALEATORIO_POR_ACAO",
  "operationId": "HEX_32_ALEATORIO_FIXO_DO_LABORATORIO",
  "expiresAt": 0,
  "scope": "https://www.googleapis.com/auth/drive.file",
  "clientBinding": "SHA256_DO_CLIENT_ID_DESKTOP_APROVADO",
  "stateBinding": "SHA256_DO_CAMINHO_ABSOLUTO_NORMALIZADO_DO_ESTADO",
  "ownerPermissionId": "IDENTIDADE_DRIVE_PRIVADA_PREVIAMENTE_APROVADA",
  "files": []
}
```

- Campos são exatos: adicionais, ausentes ou com tipo incorreto são recusados. Não há campo `parentId`, pasta editorial, URL ou scope alternativo.
- `approvalId`: 64 hexadecimais minúsculos aleatórios, novo para cada ação. Seu consumo é verificado independentemente de alterações no restante do payload. Não reutilizar IDs.
- O journal admite até 64 autorizações consumidas, incluindo criação e inspeções. O limite bloqueia novas ações para revisão; não autoriza apagar/resetar o estado.
- `operationId`: 32 hexadecimais minúsculos, mantido durante criação/reconciliação/inspeções do mesmo laboratório.
- `expiresAt`: inteiro em milissegundos UTC, futuro e no máximo uma hora à frente. Revalidado imediatamente antes de criar e ao concluir a inspeção.
- `clientBinding`: SHA-256 do `client_id` aprovado, verificado antes de carregar o SDK/sessão.
- `stateBinding`: calculado offline por `labDirectoryBinding()` de `drive-lab-state.mjs`, sobre o caminho absoluto normalizado (minúsculas no Windows). Vincula a aprovação ao mesmo diretório, impedindo reaproveitá-la em outro diretório vazio.
- `ownerPermissionId`: identidade opaca previamente conferida pelo responsável. A consulta da raiz e de cada recurso exige proprietário único igual a ela e `owners.me=true`. Não há inferência por e-mail, OIDC ou nome de exibição.
- `lab-create` exige `files=[]`. `lab-inspect` permite zero, um ou dois itens `{id, bytes, sha256}`, com IDs distintos, tamanho positivo até **64 KiB por arquivo**, e SHA-256 esperado de 64 hexadecimais. Dados reais desse registro nunca saem no terminal.

O registro local é uma barreira operacional, **não assinatura digital nem prova independente da identidade de quem aprovou**. Usuário local e administradores capazes de editar código/aprovações/estado são fronteira de confiança. A aprovação humana ocorre fora do aplicativo e deve identificar conta, cliente, diretório, operação, ação e limites sem anexar seus dados privados ao Git.

## 4. Criação única e persistência

1. Validar aprovação, prazo, scope e vínculo de diretório antes de entrar na operação.
2. Abrir `drive-lab.lock` com criação exclusiva (`wx`). Concorrência entre instâncias/processos é recusada; não há recuperação por PID, expiração de lock ou remoção automática de lock órfão.
3. Consumir a aprovação e reservar a criação, gravando o claim exclusivo `drive-lab-create-consumed.json` e o journal `drive-lab-state.json`. Cada diretório suporta **uma única criação durante sua vida**. Novo approvalId não libera outra pasta.
4. Só então carregar credenciais/sessão existente. Não iniciar login. Recusar cliente, scope ou envelope inválido. A sessão pode precisar renovar tokens em uma execução real futura explicitamente autorizada, conforme runbook OAuth.
5. Resolver somente o alias `root`, verificar raiz do My Drive, proprietário e ACL; buscar apenas o marcador próprio do laboratório para detectar recurso anterior visível. Nenhuma consulta às três pastas editoriais. Revalidar raiz/ACL antes do envio.
6. Persistir `createAttempted=true`, raiz e fase `UNCERTAIN`, **antes** da única chamada `files.create`. Corpo fixo: nome `LEVEL_XVIII_SYNTHETIC_LAB_04B3B11`, MIME de pasta, `parents=['root']` e `appProperties` abaixo. Sem mídia, destino configurável, compartilhamento, mudança de ACL ou Shared Drive.
7. Validar resposta, registrar procedência e executar inspeção em duas passagens. Somente com todas as provas válidas registrar `CREATED` e devolver resultado sanitizado.

Marcadores próprios:

| Chave | Valor |
| --- | --- |
| `levelXVIIILab` | `04B3B11-synthetic-lab-v1` |
| `levelXVIIILabOperation` | operationId privado da operação autorizada |
| `levelXVIIILabKind` | `folder` para a pasta; `fixture` para fixtures de um futuro ensaio autorizado |

Todas as chamadas Drive têm deadline de até 15 segundos, AbortSignal e `retry=false`. A camada OAuth também mantém `forceRefreshOnFailure=false` e exige tokens com `expiry_date`, evitando seu caminho de replay de 401/403. Teste usa o SDK oficial com transporte mockado para confirmar uma única tentativa de create nesses erros.

Falha anterior ao envio deixa `BLOCKED`. Falha após intenção durável, timeout, resposta perdida/tardia/incompleta ou falha da verificação deixam `UNCERTAIN`. Nunca se limpa o claim, reabre autorização ou repete `files.create`. A interrupção em `RESERVED` também bloqueia nova criação.

Journal usa checksum SHA-256 e gravação por temporário, sync do arquivo e rename. O claim exclusivo não é sobrescrito ou removido, inclusive se parcial. Journal ausente com claim, checksum inválido, claim divergente, arquivo desconhecido ou temporário órfão bloqueiam. Não apagar/editar esses arquivos para fazer o comando “passar”. Não há promessa de atomicidade distribuída, garantia contra queda de energia ou restauração maliciosa de cópia antiga.

## 5. Inspeção e reconciliação somente de leitura

Uma nova aprovação `action=lab-inspect` deve repetir cliente/diretório/operationId/proprietário. Exige intenção de criação registrada: não adota pasta manual, editorial ou de outra operação. Cada aprovação de inspeção é consumida também quando a inspeção falha.

`lab-inspect` nunca chama create/update/delete/copy, altera permissões ou transfere mídia. Suas consultas são:

- Metadados do alias `root`, único ancestral permitido da pasta.
- `files.list` filtrado por marcador próprio, operação e tipo `folder`, para localizar exatamente uma candidata. Permite reconciliar resposta de create perdida, sem criar outra pasta.
- `files.get` da candidata validada e dos arquivos **explicitamente allowlisted** no registro privado.
- `files.list` somente dos filhos diretos da pasta sintética, solicitando apenas IDs; não segue subpastas ou atalhos.
- `permissions.list` paginado da raiz, pasta e cada fixture aprovada.

Provas exigidas: My Drive, proprietário único previamente aprovado, `ownedByMe=true`, `shared=false`, `capabilities.canShare=true`, `permissionIds` e lista completa de `permissions` nos metadados concordantes com `permissions.list`. Somente uma permissão `user/owner` da própria conta é admitida neste laboratório; leitores, escritores, fotógrafo, terceiros, groups, domains e anyone são recusados. O laboratório não modifica a futura política editorial de dois publicadores.

O contrato exige `deleted=false` explícito nas permissões; campos opcionais de pendingOwner/view/herança são recusados quando ambíguos ou inseguros. Ausência de campos obrigatórios, páginas repetidas, mais de quatro páginas, respostas parciais ou `incompleteSearch` diferente de `false` bloqueiam. A ausência de `nextPageToken` é a terminação documentada; null/string vazia são recusados.

Pasta: nome/MIME/marcadores esperados, autorização `isAppAuthorized=true`, parent único igual à raiz e procedência compatível com o journal. Arquivo: autorização **individual**, marcador `fixture` da mesma operação, parent único da pasta, PNG, versão positiva, tamanho e `sha256Checksum` iguais à allowlist. Checksum de metadados não substitui inspeção dos bytes; esta CLI não baixa conteúdo.

Faz duas observações completas e compara metadados, ACLs e conjunto visível. Qualquer mudança bloqueia. Quando uma fixture esperada não aparece, não está autorizada ou retorna 403/404, falha fechado. Lista visível vazia com allowlist vazia **não comprova pasta globalmente vazia**. Mesmo no sucesso, o resultado declara `descendantVisibility=NOT_PROVEN` e `editorialAccess=NOT_PROVEN`.

Se uma criação incerta tiver exatamente uma candidata verificável, a inspeção poderá registrar `CREATED`. Não é liberação de nova criação. Zero candidatas, duplicatas ou falta de prova permanecem bloqueadas. Lock órfão/journal inválido requer revisão humana local específica antes de qualquer nova tentativa; não existe comando de reset/recovery nesta entrega.

## 6. Procedimento futuro supervisionado — não executado

1. Obter validação final deste marco e autorizações separadas para login, uso/renovação de tokens, consultas sintéticas e criação de **uma** pasta. Não incluir acesso editorial, fotos pessoais ou upload por implicação.
2. Confirmar privadamente conta exclusiva, usuário de teste e cliente Desktop, único scope `drive.file`, operador e política de encerramento. Não ampliar scopes, habilitar billing ou mudar Testing/Production para superar falhas.
3. Preparar os diretórios/ACLs externos e conferir o runbook OAuth de diagnóstico, autorização, revogação e limpeza. Sem debug, transcrição, captura de consentimento ou logs HTTP.
4. Autorizar e realizar o primeiro login supervisionado segundo o runbook OAuth. Esse login continua separado de qualquer ação do laboratório. Nenhum comando lab inicia OAuth por conta própria.
5. Após aprovação humana da criação, preencher e revisar privadamente o registro curto `lab-create`, manter o mesmo diretório de estado, conferir dry-run e só então usar a flag de execução em `drive:lab-create`. Registrar apenas resultado/instante/código sanitizados. Não imprimir o journal ou os IDs.
6. Se houver erro, parar. Não repetir create, trocar diretório ou consumir novas autorizações para contornar o bloqueio. Se houver intenção de envio, aprovar apenas uma inspeção/reconciliação de leitura com novo approvalId. Sem intenção registrada ou com estado local inconsistente, encaminhar à revisão humana, sem alteração automática.
7. Aprovar separadamente `lab-inspect` para a pasta e allowlist esperadas. Zero fixtures é aceitável somente como inspeção dos recursos observáveis, sem conclusão de inventário global.
8. Encerrar com o procedimento aprovado de revogação/limpeza local do runbook OAuth. Ele não apaga a pasta Drive nem o estado do laboratório. Remoção remota ou revisão de estado exige outra autorização.

### Ensaio posterior com até dois arquivos

Somente planejar nesta entrega: dois PNGs geométricos, por exemplo 24×24 pixels, cada um até 64 KiB e soma até 128 KiB, sem fotografias, EXIF/GPS pessoal ou dados de convidados. Guardar checksums esperados privadamente. Planejar um caso criado/autorizado por aplicativo e outro adicionado manualmente pelo proprietário, para observar limites por arquivo; o segundo pode falhar no marcador/autorização e isso deve ser registrado como falta de prova.

O mecanismo de upload/criação/seleção individual e atribuição de marcador `fixture` **não está implementado nem autorizado**. Requer novo plano e autorização antes de alimentar a pasta. Não compartilhar automaticamente com fotógrafo para montar esse ensaio. `lab-inspect` só compara metadados/checksums; eventual teste de download exigirá autorização própria e mecanismo específico, sem alterar o limite de duas fixtures desta etapa por usar o limite histórico de três do comando antigo.

## 7. Condições para liberar o primeiro login e riscos pendentes

Liberação exige revisão humana do diff/inventário, regressão e auditoria de segurança aprovadas, aceite das limitações dos mocks/binários, conta/cliente de teste confirmados, ACLs/caminhos externos verificados, escopo único aceito e procedimentos de revogação/expiração prontos. Autorização atual é exclusivamente offline; a primeira sessão real ainda depende de autorização explícita do responsável.

Ainda não comprovados no Google: leitura de `root`/ACL sob `drive.file`, preenchimento real dos campos false/owners/permissions/permissionIds/SHA-256, concordância entre superfícies da ACL, paginação e cancelamento do SDK. Campos omitidos podem causar bloqueio conservador; isso é pendência de viabilidade, não motivo para inventar evidência, assumir defaults ou ampliar scope.

AppProperties e nomes não são identidade humana nem barreira contra usuário local/proprietário malicioso. O limite de uma criação depende da conservação do diretório vinculado e do claim/journal; apagamento completo, rollback externo ou alteração por administradores não são resolvidos por esta CLI. Locks são locais ao mesmo filesystem, sem coordenação entre máquinas/copias de estado. Há janela de mudança remota após a última verificação; snapshots não são transação Drive. Não foi homologado fluxo editorial, publicação automática ou uso em produção.

Auditoria de segredos é baseada em padrões e não prova ausência universal. Os seis binários existentes não foram inspecionados para conteúdo sensível; sua integridade por checksum é uma verificação distinta. Detalhes e resultados em [relatório 04B.3B.11](VALIDACAO_MARCO_04B_3B_11.md).

Contratos consultados offline: tipos/comentários do SDK instalado `googleapis/build/src/apis/drive/v3.d.ts` (files, parents, permissions, permissionIds, isAppAuthorized) e implementação OAuth instalada de `google-auth-library`. Não houve consulta online de documentação ou serviço Google nesta implementação.

## 8. Identidade Drive — Marco 04B.3B.18.3

**Estado:** implementação local autorizada, preparada e testada com dados inventados; a consulta real de identidade continua pendente de autorização própria e validação final do responsável. Baseline: `feature/live-experience`, `739fc91`, 388 testes existentes. Evento: **28/11/2026 às 21h em Belém/PA**. As seções anteriores descrevem o laboratório preservado do Marco 04B.3B.11.

### 8.1 Comando e reutilização

```powershell
npm.cmd run drive:identity
npm.cmd run drive:identity -- --dry-run
```

Os dois retornam `DRY_RUN`, scope fixo e `effects=NONE` antes de ler configuração privada, credenciais, tokens, identidade ou ACL, carregar SDK, iniciar navegador, abrir sockets, acessar rede ou gravar dados. Argumentos de fields, scope, endpoint, saída ou comando adicional são recusados sem eco. A flag de execução existe para uso **futuro**, depois de autorização expressa; nenhum processo CLI foi iniciado com essa flag nesta entrega. Os testes a tratam apenas como dado de parse ou dispatch programático com dependências mockadas.

O único módulo novo, `src/drive-identity.mjs`, reutiliza SDK oficial, cliente Desktop, sessão OAuth, token store, envelope, validação de caminhos/ACL e sanitização. Não contém fluxo OAuth novo, ADC, chave de serviço ou lógica paralela de renovação. `authorizedSession()` é chamado por um adaptador que observa a referência da autorização já validada; tokens são carregados e eventualmente renovados/persistidos pelos controles anteriores. Nenhum arquivo OAuth ou laboratório foi alterado.

Em futura execução autorizada, a única chamada de dados Google será `about.get` com `fields='user(permissionId,me)'`, timeout de até 15 segundos, AbortSignal e `retry=false`. O replay forçado de OAuth em erro é desativado, seguindo o laboratório. Não consulta files, permissions, pastas, fotografias ou perfil ampliado. Exige status 200 e corpo exato com somente `user`, e somente `permissionId` e `me` dentro dele; campos extras ou omitidos bloqueiam. `me` precisa ser booleano true; ID opaco textual entre 1 e 256 caracteres compatíveis com o contrato existente. Não exige que o ID seja número, e-mail, UUID ou subject OIDC.

### 8.2 Preparação privada e isolamento

| Configuração futura | Finalidade |
| --- | --- |
| `LEVEL_DRIVE_IDENTITY_DIR` | Diretório privado novo, dedicado e externo, já existente; não é criado automaticamente. |
| `LEVEL_DRIVE_CREDENTIALS_FILE` | JSON Desktop externo existente; seu diretório representa Segredos para verificar isolamento. |
| `LEVEL_DRIVE_TOKEN_DIR` | Diretório de Tokens existente, usado pelos validadores OAuth originais. |
| `LEVEL_DRIVE_LAB_STATE_DIR` | Local planejado/existente do LabState, somente metadados de caminho para impedir sobreposição. |
| `LEVEL_DRIVE_LAB_APPROVAL_FILE` | Local planejado/existente de uma aprovação; usa somente o diretório/caminho, sem ler ou gerar a aprovação. O arquivo pode estar ausente. |
| `LEVEL_DRIVE_IDENTITY_ACCOUNT_CONFIRMED` | Deve ser exatamente `true`, declarado pelo operador somente após confirmar humanamente a conta da sessão. |

Todos os caminhos são absolutos e privados, configurados somente na sessão futura. Não criar `.env` ou registrar valores/caminhos pessoais no Git/terminal/relatório. LabState pode ainda não existir como último componente do caminho, desde que o pai exista. O registro de aprovação não precisa existir: conhecer o destino planejado permite bloquear a sobreposição sem gerar uma aprovação operacional.

O diretório de identidade deve ser disjunto de Tokens, do diretório de Segredos, de LabState e do diretório de LabApprovals. São recusadas igualdade e relações de ancestral/descendente, inclusive diferenças apenas de caixa no Windows. Dentro da identidade são aceitos apenas `drive-identity.json` e `drive-identity.lock`. Diretórios/caminhos não configurados, conteúdo desconhecido, paths internos ao repositório, ancestrais dele, UNC, hardlinks, junctions/symlinks ou dispositivos causam bloqueio. Os demais diretórios não são modificados nem varridos em busca de conteúdo.

ACL de identidade e lock é verificada; o arquivo de identidade recebe criação `wx` e tem ACL conferida **antes de escrever bytes**. Windows conserva a política existente de usuário atual, SYSTEM e Administradores; POSIX exige proprietário e ausência de acesso por grupo/outros. Não há mudança automática de ACL nem fallback de permissões.

### 8.3 Registro privado, concorrência e falhas

O registro é JSON de formato exato, kind `LEVEL_XVIII_DRIVE_IDENTITY_V1`, contendo somente:

| Campo | Uso privado |
| --- | --- |
| `ownerPermissionId`, `me` | Identificador confirmado pela resposta; me precisa ser true. |
| `scope` | Valor fixo drive.file. |
| `clientBinding` | Mesmo vínculo privado de cliente já usado no envelope OAuth. Nunca é impresso. |
| `authorizedAt`, `refreshTokenExpiresAt` | Referência da autorização OAuth de origem; não representam tokens. |
| `observedAt`, `expiresAt` | Instante da consulta e validade até uma hora, limitada pelo prazo de refresh da autorização. |

Não guarda access token, refresh token, Client ID, client secret, hash de token, e-mail, nome ou foto. Campos adicionais, inclusive tokens, são recusados no carregamento. O identificador e o vínculo privado não aparecem em mensagens de sucesso/erro; stdout/stderr usam whitelist de campos e códigos estáticos. IDs parciais e hashes que permitam correlação também não são publicados.

`drive-identity.lock` é criado exclusivamente antes de ler/consultar/criar identidade. Uma segunda instância ou processo é recusado. Não há timeout de recuperação do lock, reset, limpeza ou remoção automática de lock órfão. O lock é vazio e não contém identificador; a persistência do registro só começa após resposta válida e conferência da sessão.

O arquivo é criado exclusivamente, sem sobrescrever destino existente. Após escrita, sync, fechamento e releitura protegida, o lock normal é liberado. Falha de escrita, sync, ACL ou confirmação final mantém arquivo e lock para revisão, mesmo quando os bytes já formam JSON válido: o carregador não aceita esse resultado incerto. Não há rename que possa sobrescrever destino nem exclusão do arquivo parcial. Crash também deixa lock, sem recuperação automática.

Repetir captura de registro válido faz nova consulta mínima, exige mesma conta/cliente/autorização e devolve `IDENTITY_ALREADY_VERIFIED`, sem regravar ou estender validade. Registro vencido, desconhecido, parcial ou corrompido permanece bloqueado para revisão humana; não é substituído automaticamente.

Cliente ou autorização divergentes são detectados pela referência validada do envelope. Conta divergente é detectada por nova consulta e comparação do ID, inclusive no carregador. A referência é revalidada após a consulta, com comparação do refresh token somente em memória, antes da persistência OAuth final. Não se armazena/imprime hash de token. Não executar outro processo de autorização, renovação, revogação ou edição dos tokens durante essa operação.

401/403/404/429/5xx, timeout, resposta tardia, campos faltantes ou `me` ausente/falso causam erro sanitizado e impedem gravar identidade. A renovação de token pelo mecanismo OAuth original pode ocorrer antes da consulta em uma futura execução autorizada; falha posterior não desfaz essa renovação nem deve ser descrita como escrita de identidade. Nesta entrega somente MemoryTokenStore e dados sintéticos foram usados nesses caminhos.

### 8.4 Carregador e futura ligação com lab-create

`loadPrivateDriveIdentity()` também retorna dry-run por padrão. Quando futuramente executado com autorização própria, exige registro existente, confirmação humana, validação de ACL/caminhos, mesma autorização/cliente e **nova consulta about.get**. Portanto, não é um carregador offline quando executado. Pode receber uma expectativa privada de proprietário e recusará divergência. Retorna apenas ID e referências mínimas em memória para um consumidor confiável; nunca imprimir, serializar para saída pública ou registrar esse retorno.

Nenhum gerador de aprovações foi implementado. A ligação futura deverá ler esse material privadamente e, somente sob nova autorização, preencher `ownerPermissionId` na aprovação operacional. Não usar copiar/colar pelo terminal, argumento CLI, clipboard ou arquivo público. Não inferir ID por e-mail, Client ID ou `sub`.

O `lab-create` existente permanece inalterado e não passa a carregar automaticamente esse registro. Continua verificando proprietário da raiz, `owners.me`, permissionIds e ACLs de todos os recursos. Uma conta trocada bloqueia a criação; no fluxo atual isso pode consumir a reserva antes da falha, sem rearmá-la. A identidade obtida não certifica ACL remota, visibilidade dos descendentes, OIDC dos dois publicadores ou permissão de publicação.

### 8.5 Procedimento futuro supervisionado — não executado

1. Obter validação final desta implementação e autorização separada para uma consulta mínima de identidade, uso/renovação dos tokens e gravação privada. Login, se necessário, exige sua própria aprovação e o runbook OAuth anterior; o comando de identidade nunca o inicia.
2. Confirmar privadamente conta pretendida, usuário de teste e cliente Desktop. `me=true` significa apenas usuário da sessão: a escolha correta da conta exige confirmação humana supervisionada, sem ampliar fields ou scopes para buscar e-mail.
3. Preparar e revisar o diretório privado de identidade e os cinco caminhos de isolamento. Não usar pastas servidas, compartilhadas ou de sincronização pública. Não ler, alterar ou criar LabApprovals/estado do laboratório para executar esta preparação.
4. Configurar os caminhos na sessão e declarar a confirmação da conta; desativar debug/transcrição/log HTTP, debugger e capturas de consentimento. Revisar expiração, revogação e responsáveis.
5. Conferir os dois previews. Somente depois da autorização específica usar a flag de execução do comando `drive:identity`. Registrar apenas status/código/instante, sem caminhos, IDs, hashes ou conteúdo JSON.
6. Em divergência, erro ou lock órfão, parar e pedir revisão específica. Não apagar, sobrescrever, ampliar scope, trocar estado do laboratório ou criar nova pasta para contornar a falha.
7. Um consumidor futuro autorizado poderá usar o carregador privado, sabendo que ele fará nova consulta. Isso não concede autorização para gerar `lab-create` ou criar pasta. Os tokens e o registro de identidade devem ser administrados separadamente; o comando de limpeza de tokens não apaga identidade.

### 8.6 Riscos e limitações

- Ainda não houve consulta real. Campos opcionais, omissões, cancelamento e políticas reais podem provocar recusa conservadora. Isso não autoriza ampliar scope ou relaxar validações.
- A declaração de confirmação da conta é um controle operacional, não prova criptográfica da identidade humana. Na primeira captura não há ID anterior para comparação; operador e conta supervisionada constituem a base da confiança.
- Registro privado não é assinatura digital/cofre criptografado; usuário local e administradores podem editar dados/código. Referência da autorização e comparação remota detectam divergências comuns, sem garantir proteção contra adulteração coordenada por esses atores.
- Lock é local ao diretório e filesystem, sem coordenação distribuída. Sync e bloqueio de resultados incertos não são backup contra perda completa, rollback externo ou queda de energia. Nenhum processo OAuth concorrente foi homologado.
- Há janela entre consulta, validação e consumo futuro. Validade curta não substitui revalidação, autorização humana ou ACL do laboratório.
- A auditoria de padrões textuais não comprova ausência universal de segredos. Os seis binários existentes continuam sem inspeção de conteúdo sensível; comparação de integridade por hash não elimina essa limitação.

## 9. Relatório técnico do Marco 04B.3B.18.3

O relatório está incorporado neste arquivo para respeitar a autorização de somente dois arquivos novos e quatro existentes modificados. **Status:** implementação exclusivamente local; aguardando validação final do responsável.

| Ação | Arquivo relativo a tools/live-experience-local | Resultado |
| --- | --- | --- |
| Criado | `src/drive-identity.mjs` | CLI, consulta mínima, validação, armazenamento privado exclusivo e carregador preparado. |
| Criado | `test/drive-identity.test.mjs` | I01–I24: mocks, testes negativos, SDK com transporte simulado, ACL real de temporários e regressão. |
| Modificado | `package.json` | Somente script `drive:identity`; dependências/lockfile preservados. |
| Modificado | `README.md` | Entrada, limites e link para este runbook/relatório. |
| Modificado | `GOOGLE_DRIVE_OAUTH.md` | Reutilização da sessão e separação da identidade. |
| Modificado | `GOOGLE_DRIVE_LAB.md` | Seções 8–9; identidade, riscos, procedimento futuro e este relatório. |

Os 64 arquivos rastreados restantes de `739fc91`, incluindo todos os módulos OAuth/laboratório, suítes e fixtures anteriores, convite, frontend, motor e documentos mestres, são verificados por integridade no novo teste I21. Os hashes de baseline respeitam os bytes originais LF/CRLF sem normalizar arquivos protegidos. Nenhum registro privado operacional, aprovação lab-create, pasta Google ou mídia foi criado/consultado. Não houve login, processo CLI com execução habilitada, upload, download, commit, push, merge ou deploy.

### 9.1 Evidências finais

| Verificação | Resultado |
| --- | --- |
| `npm.cmd run check` | Aprovado: **27 arquivos** com sintaxe válida. |
| `npm.cmd test` | **484/484 aprovados: 388 anteriores + 96 novos**, zero falhas, cancelamentos, skips ou TODOs. |
| `npm.cmd run drive:identity` | DRY_RUN, effects=NONE, sem mudança de publicação. |
| `npm.cmd run drive:identity -- --dry-run` | Mesmo preview seguro. |
| `git diff --check` | Aprovado, sem erros de whitespace; Git informa apenas conversão LF/CRLF conforme configuração existente. |
| `git status --short --branch` | Mesma branch/HEAD; somente quatro modificados e dois novos autorizados; nada staged. |
| I21, L20, S13 e T12 | Arquivos protegidos, módulos OAuth/laboratório e suítes anteriores preservados. |
| Auditoria de package.json | Scripts anteriores, dependências e demais campos preservados; somente um script novo. |

Resumo do runner na execução final:

```text
tests 484
pass 484
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 81857.8127
```

| Testes novos | Cobertura |
| --- | --- |
| I01–I04 | Dry-run sem efeitos, parse estrito, fields exatos, captura mínima, repetição sem sobrescrever e carregador privado. |
| I05–I06 | Divergência de conta, cliente, autorização e troca de token durante consulta. |
| I07–I10 | 21 variantes de resposta incompleta/inválida; HTTP 401/403/404/429/5xx; timeout/abort/resposta tardia; sessão/runtime inseguros. |
| I11–I16 | Renovação pelo fluxo existente, validade curta, esquema sem tokens, ausência de vazamento, falha de gravação e expiração durante consulta. |
| I17–I20 | Lock entre processos, reinício, preservação de sentinelas sintéticas de outros diretórios, sobreposição de caminhos, corrupção, hardlink, junction e ACL insegura. |
| I21–I22 | Integridade dos 64 arquivos protegidos; SDK oficial com transporte mockado, fields mínimos e tentativa única em erros HTTP. |
| I23–I24 | Falhas de write/sync, colisão de destino e ACL antes dos bytes deixam arquivo/lock bloqueados, sem sobrescrita ou publicação de resultado incerto. |

Os testes usam tokens, IDs, aprovações fictícias/sentinelas e respostas exclusivamente sintéticos; nenhum transporte Google é usado. A suíte anterior inclui apenas servidores HTTP loopback de teste. Os temporários novos são externos, têm ACL privada e teardown com verificação de raiz/prefixo antes da exclusão pontual. Somente dados inventados são colocados nesses temporários.

As execuções com ACL real de temporários ocorreram no ambiente de teste já autorizado fora da sandbox. O bloqueio histórico da sandbox sobre temporários privados permanece documentado no relatório 04B.3B.11. Nenhum teste foi desativado ou controle de ACL enfraquecido para contornar esse limite.

Durante desenvolvimento, corrigiram-se somente o relógio da fixture do SDK e a chamada de restauração dos mocks novos de fs.open. A primeira execução completa apontou cinco falhas do harness; depois da correção a suíte completa passou. Não houve alteração de módulos protegidos, expectativas anteriores ou controles de segurança para corrigir essas falhas.

### 9.2 Auditoria e pendências de aceite

Varredura textual local de **68 rastreados** (62 textuais e seis binários excluídos da inspeção de conteúdo), **dois novos textuais** e **3.045 ignorados**. Foram usados padrões de chaves Google/OAuth, tokens conhecidos, blocos privados, JWT, literais sensíveis e tokens de convidado em query. Nenhum segredo foi identificado pelos padrões utilizados; fixtures explícitas e sete exemplos comentados do SDK foram classificados sem imprimir valores. Não foram criados logs, manifesto operacional, token file ou registro real de identidade dentro do repositório.

A varredura não é conclusiva para ausência universal de segredos, não abrange conteúdo sensível dos seis binários nem credenciais externas/histórico/backups. Os binários são preservados por checksum, sem inspeção visual ou de dados embutidos. As limitações da seção 8.6 continuam abertas.

**Aguardando validação final do responsável:** revisão dos seis arquivos, evidências, isolamento e aceitação dos riscos. Depois desse aceite, ainda será necessária autorização separada para consulta real de identidade, uso/renovação de tokens e escrita privada, com conta pretendida supervisionada. Login, geração de lab-create, criação/inspeção de pasta, fotos, publicação e produção continuam fora da autorização desta entrega.

## 10. Preparador offline — Marco 04B.3B.18.8

**Baseline:** `feature/live-experience`, `d2ec6bb`, 484 testes existentes e Git inicialmente limpo. **Escopo desta entrega:** implementação local, documentação e testes com fixtures e temporários sintéticos. Nenhum arquivo real de credenciais, tokens, identidade ou laboratório foi lido. Nenhuma aprovação operacional foi gerada. Evento preservado: **28/11/2026 às 21h em Belém/PA**.

O responsável informou consulta real de identidade bem-sucedida e estado privado preparado antes desta etapa. Esses dados são contexto fornecido, sem reinspeção nesta implementação. As seções anteriores registram os marcos históricos; não descrevem novas consultas ou liberações automáticas.

### 10.1 Comando e contrato

```powershell
npm.cmd run drive:lab-prepare
npm.cmd run drive:lab-prepare -- --dry-run
```

Ambos retornam `DRY_RUN`, `effects=NONE`, `googleContacted=false` e `publicationChanged=false`. O retorno precede leitura de ambiente privado, arquivos/ACL, SDK, sockets, rede, entropia operacional e escrita. Não há CLI para informar payload, IDs, scope, validade ou destino arbitrários. Uma futura gravação exige autorização humana específica e flag explícita; nenhum processo CLI com execução habilitada foi iniciado nesta entrega. Testes usam dispatch programático e configuração exclusivamente sintética.

O preparador valida e produz somente os dez campos exatos de `LEVEL_XVIII_DRIVE_LAB_APPROVAL_V1`:

| Campo | Regra |
| --- | --- |
| kind | Constante `LEVEL_XVIII_DRIVE_LAB_APPROVAL_V1`. |
| action | Sempre `lab-create`. |
| approvalId | `randomBytes(32)` em hexadecimal minúsculo, 64 caracteres / 256 bits. |
| operationId | `randomBytes(16)` em hexadecimal minúsculo, 32 caracteres / 128 bits. |
| expiresAt | Menor prazo entre agora + uma hora, validade da identidade e validade da concessão OAuth. |
| scope | Constante original `https://www.googleapis.com/auth/drive.file`. |
| clientBinding | Obtido somente do envelope OAuth validado com as credenciais Desktop, igual ao da identidade. |
| stateBinding | Resultado de `labDirectoryBinding()` após validar o diretório absoluto real de LabState e sua ACL. |
| ownerPermissionId | Exclusivamente do registro privado de identidade validado. |
| files | Sempre array vazio. |

`validateLabApproval()` é usado antes da escrita, na releitura do temporário e do destino. Não se acrescentam timestamp de autorização, assinatura, checksum ou wrapper ao V1. A integridade da preparação é verificada por esquema, comparação integral privada, leitura estável, ACL e identidade do arquivo no filesystem, sem publicar hashes de associação.

Exigem-se pelo menos **cinco minutos restantes** de validade, rechecados durante e depois da publicação. A margem é fixa, sem flag para reduzi-la, e não garante duração do ensaio real. Identidade vencida, referência OAuth incompatível ou tempo insuficiente bloqueiam; não há extensão automática de prazo, nova identidade ou renovação de tokens.

### 10.2 Configuração futura e isolamento

Reutilizam-se os cinco caminhos existentes: `LEVEL_DRIVE_CREDENTIALS_FILE`, `LEVEL_DRIVE_TOKEN_DIR`, `LEVEL_DRIVE_IDENTITY_DIR`, `LEVEL_DRIVE_LAB_STATE_DIR` e `LEVEL_DRIVE_LAB_APPROVAL_FILE`. Os diretórios de Segredos (pai das credenciais), Tokens, Identidade, LabState e LabApprovals precisam existir, ser privados e mutuamente disjuntos. Igualdade e relações de ancestral/descendente são recusadas, inclusive diferenças somente de caixa no Windows. Não se criam diretórios automaticamente.

Na futura sessão supervisionada, `LEVEL_DRIVE_LAB_PREPARE_CONFIRMED` e `LEVEL_DRIVE_IDENTITY_ACCOUNT_CONFIRMED` precisam ser exatamente `true`. São declarações operacionais do responsável, não identidade criptográfica ou substituto de aprovação humana. Não criar `.env` ou registrar os valores dos caminhos no repositório.

LabState deve estar **vazio**: nenhum journal, claim, lock ou arquivo inesperado. A conferência é de leitura; o preparador não chama operações que reservem criação, consumam aprovação ou gravem estado. LabApprovals aceita somente o destino configurado, `drive-lab-prepare.lock` e o temporário pertencente à operação corrente. Órfãos, conteúdo desconhecido, destino preexistente, links inesperados ou caminhos inseguros bloqueiam. O arquivo de aprovação nunca é criado dentro de LabState, Identidade, Tokens ou Segredos.

São reutilizadas validações externas de paths, recusa de UNC/junctions/symlinks/hardlinks/dispositivos, ACL e runtime silencioso. Windows admite somente os principais confiáveis da política original; 0600 sozinho não certifica privacidade Windows. Nenhum controle ou ACL é alterado automaticamente.

### 10.3 Leitura offline das fontes

`DriveIdentityStore.withLock()` e sua leitura privada são reutilizados sem chamar o carregador de identidade que faz nova consulta. A identidade JSON é validada por `validateIdentityRecord()` contra o envelope atual. Credenciais e tokens são carregados somente pelos leitores privados existentes e `validateTokenEnvelope()`; Client ID fica restrito à memória desse fluxo e nunca é impresso ou persistido na aprovação.

Conferem-se cliente, `authorizedAt`, `refreshTokenExpiresAt`, identidade, schema e scope único. As fontes são relidas antes do hardlink e novamente durante a janela de dois links. Mudanças nos metadados da autorização, identidade, access token ou refresh token bloqueiam; comparação de tokens ocorre apenas em memória, sem hash público ou persistido. Buffers de serialização e de entropia são zerados após uso; isso não garante eliminação de todas as cópias de strings no heap/OS.

O preparador não carrega SDK, não inicia sessão ou login, não chama o carregador online de identidade e não consulta Google. Um access token vencido não é renovado nessa etapa: a validade local da identidade/concessão pode permitir preparar a aprovação, e eventual renovação no consumo real continua ação do fluxo OAuth existente e da autorização correspondente.

### 10.4 Publicação exclusiva em Windows/NTFS

Suporte operacional desta entrega: **Windows com volume local NTFS**. O tipo do volume é conferido por metadados locais via PowerShell, sem imprimir drive/path. Plataforma diferente, volume não NTFS ou impossibilidade de conferir o volume bloqueiam. O hardlink precisa funcionar nativamente no mesmo diretório/filesystem; não há fallback com rename, cópia ou substituição.

1. Validar diretórios, ACL, LabState vazio e destino ausente. Adquirir o lock exclusivo próprio em LabApprovals, com ACL privada e sync. Revalidar após o lock.
2. Sob o lock da identidade, ler e validar as fontes locais. Gerar IDs criptográficos e montar o V1 em memória; revalidar prazo e contrato.
3. Criar temporário exclusivo no mesmo LabApprovals. Conferir tipo, inode/device, link único e ACL privada **antes de escrever bytes**. Escrever, sincronizar, fechar, reler protegidamente e comparar o objeto completo.
4. Revalidar fontes, diretórios, ACL, prazo e destino ausente. `fs.link(temporário, destino)` publica sem substituir um nome existente. EEXIST e falhas de suporte não são contornadas.
5. Verificar que ambos os nomes são arquivos regulares do mesmo inode/device, com exatamente dois links e tamanho esperado. Nessa janela, `readPrivateJson(destino)` rejeita o arquivo pelo nlink=2: o consumidor existente não aceita esse estado intermediário.
6. Revalidar fontes, ACLs, LabState vazio e tempo restante. Remover somente o nome temporário próprio, deixando nlink=1. Conferir identidade do arquivo final, releitura privada e contrato. Liberar os locks próprios apenas no encerramento normal.

O sucesso retorna somente status estático e flags de isolamento, sem ID, valor de associação, Client ID, token, path ou conteúdo do JSON. O preparador não inicia `drive:lab-create` e não remove o arquivo de aprovação depois de produzi-lo.

### 10.5 Falhas e resultados incertos

Não há retry automático. Falhas após início de escrita/publicação preservam o lock do preparador e os artefatos para revisão. Lock órfão, temporário órfão, destino existente ou resultado incerto impedem nova geração. Não gerar outros IDs, mudar nome/caminho ou limpar evidências para contornar o bloqueio.

Falha de hardlink deixa temporário/lock; falha antes da remoção do temporário pode deixar dois links e o consumidor continua recusando o destino. **Falha depois de remover o temporário ou na limpeza final pode deixar uma aprovação íntegra e legível com resultado do preparador incerto.** O consumidor atual não conhece o lock do preparador: nesse caso o operador deve parar e exigir revisão humana, sem executar consumo. A entrega não promete atomicidade conjunta entre resposta do processo, disco, fontes e consumidor independente.

O consumo é lógico no journal do laboratório: o arquivo de aprovação pode continuar existindo, mas approvalId consumido e claim de criação bloqueiam reutilização. O preparador não modifica esses mecanismos, não reinicializa LabState e não reemite automaticamente aprovação vencida ou usada.

### 10.6 Procedimento futuro supervisionado — não executado

1. Obter validação final desta implementação e autorização específica para a **geração local** com leitura das fontes privadas. A autorização informada para uma futura pasta permanece separada; esta entrega não a inicia.
2. Conferir privadamente conta pretendida, cliente, validade da identidade/concessão, ACLs, ausência de locks/órfãos, LabState vazio e destino ausente. Preparar Windows/NTFS local e impedir processos concorrentes de OAuth, edição de fontes, preparação ou consumo.
3. Configurar os caminhos e as confirmações operacionais somente na sessão supervisionada. Desativar debug, transcrição, logs HTTP, capturas e instrumentação sensível. Conferir dry-run.
4. Somente após autorização específica usar a flag de execução de `drive:lab-prepare`. O efeito será exclusivamente local. Registrar apenas código/status/instante, sem abrir ou imprimir a aprovação.
5. Em qualquer erro, parar. Não sobrescrever, repetir automaticamente, remover locks/artefatos ou executar `lab-create` para tentar resolver incerteza. Revisão/limpeza exigem ação humana autorizada separadamente.
6. Após sucesso inequívoco e nova conferência local de condições, realizar o consumo futuro já autorizado numa janela supervisionada. Mudança de conta, cliente, concessão ou estado entre etapas exige reavaliação; não acrescentar campos ao V1 nem copiar IDs pelo terminal.

**A preparação offline não comprova ausência de revogação remota e não substitui a verificação da identidade e das permissões no momento da criação.** O V1 não carrega a referência completa da concessão: as comparações locais protegem a preparação, enquanto o consumidor mantém verificação de cliente, proprietário e ACLs. Divergência no consumo pode reservar/consumir a autorização antes de bloquear; não rearmar automaticamente.

Outros riscos: operador e administradores locais são fronteira de confiança; identidade privada não é assinatura digital; locks são locais ao mesmo filesystem, sem coordenação distribuída. Sync e releitura não são backup nem garantia contra queda de energia, perda/rollback de estado ou alterações coordenadas por ator local confiável. A margem de cinco minutos é conservadora e não um SLA. Campos/ACL reais ainda podem ser insuficientes no ensaio Drive, exigindo bloqueio sem ampliação de scope. Os seis binários preexistentes continuam sem inspeção de conteúdo sensível.

## 11. Relatório técnico do Marco 04B.3B.18.8

O relatório fica neste arquivo para respeitar o escopo autorizado de **dois novos e três modificados**. Baseline inicial confirmado: branch `feature/live-experience`, HEAD `d2ec6bb`, Git limpo. AGENTS.md, Documento Mestre e contratos existentes foram lidos antes da implementação.

| Ação | Arquivo relativo a tools/live-experience-local | Entrega |
| --- | --- | --- |
| Criado | `src/drive-lab-approval.mjs` | Preparador offline, contrato exato, margem mínima, isolamento, lock e publicação por hardlink. |
| Criado | `test/drive-lab-approval.test.mjs` | P01–P21: negativos, contrato/tempo, privacidade, consumo simulado e filesystem real Windows/NTFS. |
| Modificado | `package.json` | Somente script `drive:lab-prepare`. Dependências/lockfile preservados. |
| Modificado | `README.md` | Entrada e referência ao runbook/relatório. |
| Modificado | `GOOGLE_DRIVE_LAB.md` | Seções 10–11: procedimentos, riscos, evidências e este relatório. |

Todos os 67 arquivos restantes do baseline são protegidos pelo teste novo P21, incluindo módulos OAuth, identidade, laboratório, motor, testes anteriores, frontend e documentos mestres. O baseline original de bytes LF/CRLF é respeitado. Nenhum módulo existente ou teste anterior foi alterado. Não houve leitura de fontes reais, geração de aprovação operacional, conexão Google, renovação/login, pasta Drive, upload/download, faturamento, commit, push, merge ou deploy. Somente fixtures e temporários sintéticos foram usados; sentinelas de fontes privadas e LabState são verificados nos testes.

### 11.1 Evidências finais

| Verificação | Resultado |
| --- | --- |
| `npm.cmd run check` | Aprovado: sintaxe válida em **29 arquivos**. |
| `npm.cmd test` | **547/547 aprovados: 484 anteriores + 63 novos**, zero falhas, cancelados, skips ou TODOs. |
| `npm.cmd run drive:lab-prepare` | DRY_RUN, effects=NONE, googleContacted=false, publicationChanged=false. |
| Preview com `-- --dry-run` | Mesmo resultado seguro, sem leitura de fontes reais. |
| `git diff --check` | Aprovado; apenas avisos de conversão LF/CRLF da configuração Git existente. |
| `git status --short --branch` | Mesma branch/HEAD; somente os dois novos e três modificados autorizados; nada staged. |
| P21 e testes históricos de preservação | 67 arquivos protegidos de d2ec6bb, módulos existentes e testes anteriores intactos. |
| Auditoria de package.json | Scripts anteriores, dependências e demais campos preservados; somente um script novo. |
| Windows/NTFS real | Tipo NTFS confirmado; hardlinks temporários comprovados no filesystem, sem rede. |

Resumo do runner final:

```text
tests 547
pass 547
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 186981.6028
```

| Testes | Evidência |
| --- | --- |
| P01–P03 | Preview sem efeitos, parse estrito, dez campos, entropia nos tamanhos exigidos e vínculos privados corretos. |
| P04–P07 | Menor dos três prazos, margem mínima, identidade inválida/vencida, divergências de cliente/conta/autorização e recusa de schema/scope ampliados. |
| P08–P12 | Nenhuma consulta/renovação, confirmação/runtime, concorrência em memória, ausência de vazamentos, consumo simulado único e plataforma não suportada recusada. |
| P13 | Pipeline com leitores privados reais sobre fixtures: arquivo final com nlink=1; durante a publicação ambos os nomes têm nlink=2 e o leitor existente os recusa. Fontes e LabState preservados. |
| P14–P17 | Lock exclusivo entre processos, diretórios sobrepostos, caminhos inseguros, junction/hardlink, estado ocupado, órfãos, destino existente e recusa de sobrescrita. |
| P18–P20 | Falhas de write/sync/link/limpeza, colisão, incerteza antes/depois de remover temporário, ACL antes dos bytes e mudanças após hardlink preservam evidências e bloqueiam novas tentativas. |
| P21 | Integridade dos arquivos protegidos e ausência de chamadas online, renovação ou rename no preparador. |

O teste P13 rodou em Windows/NTFS local e confirmou inode/device iguais e exatamente dois links na janela intermediária. `readPrivateJson()` rejeitou esse destino com `HARDLINK_FILE_FORBIDDEN`; após remoção do temporário, a mesma aprovação foi lida e validada com link único. P18 exercitou a falta de suporte a hardlink e não houve fallback ou retry. Também demonstrou a limitação documentada: depois de uma limpeza efetivada, o destino pode ser válido enquanto o resultado do preparador permanece incerto e exige revisão humana.

As execuções usam o ambiente local já autorizado para ACLs privadas fora da sandbox, sem enfraquecer controles ou editar expectativas anteriores. Testes de ACL aberta usam somente fixtures deliberadamente inseguras para comprovar recusa; nenhum diretório real foi alterado. Os temporários ficam sob prefixo próprio e teardown confere raiz e prefixo antes da remoção. Os servidores HTTP das suítes históricas são apenas loopback de teste, sem autenticação Google real.

### 11.2 Auditoria e aceite pendente

Auditoria de escopo confirmou exatamente cinco arquivos autorizados. A varredura textual de padrões em arquivos rastreados e novos não identificou segredos; valores explicitamente sintéticos foram classificados sem impressão. Os seis binários existentes foram excluídos dessa inspeção de conteúdo, e sua integridade é verificada separadamente por checksum. Não houve leitura de diretórios privados reais ou de arquivos ignorados em busca de credenciais. Padrões textuais não comprovam ausência universal de segredos, nem cobrem dados externos, histórico completo ou backups.

O resultado desta entrega é código e evidência de testes locais. **Aprovação operacional real não foi gerada, LabState real não foi lido/modificado e pasta Drive não foi criada.** Não houve execução CLI com dados privados reais, acesso Google, upload/download, alteração de permissões na nuvem, atualização de dependências ou commit.

**Aguardando validação final do responsável:** revisão do inventário, testes, publicação NTFS, margem de validade e limitações. A preparação real futura exige autorização específica de leitura/gravação local e condições da seção 10.6. A autorização já informada para uma pasta futura continua separada e não foi executada. Preparação offline não comprova ausência de revogação remota e não substitui identidade e permissões no momento da criação.

## 12. Diagnóstico local sanitizado — Marco 04B.3B.18.17

Baseline: `feature/live-experience`, `91c725f`, 547 testes anteriores, Git inicialmente limpo.
O responsável informou um `DRIVE_HTTP_404` em criação real, seguido de journal e claim existentes.
O diagnóstico operacional desses arquivos permanece pendente de validação e autorização próprias.
Esta implementação usa exclusivamente fixtures inventadas e temporários de teste.

### 12.1 Comando e isolamento

```powershell
npm.cmd run drive:lab-diagnose
npm.cmd run drive:lab-diagnose -- --dry-run
```

Ambos são previews, com `phase=DRY_RUN`. Para manter exclusivamente os nove campos autorizados,
não se acrescentam `mode`, `error`, scope, nomes, caminhos, timestamps ou contagens à saída.
Todos os outros campos retornam `UNKNOWN`: o preview não inspeciona configuração, ACL ou arquivos.
`npm.cmd run --silent drive:lab-diagnose` omite também o cabeçalho padrão do npm.

`src/drive-lab-diagnose.mjs` importa apenas filesystem/path/url e os módulos existentes de estado e
proteção privada. Não importa SDK, sessão OAuth, identidade, preparador, motor de criação ou publicação.
Não carrega credenciais, tokens, aprovação ou identidade. Não solicita renovação nem usa rede, sockets,
navegador ou API Google. Não chama `withLock()`, writer, criação, recuperação ou limpeza de estado.
Os únicos arquivos abertos são os dois nomes fixos de journal e claim, em `O_RDONLY`.
Leituras comuns podem atualizar atime pelo sistema operacional; não há gravação de conteúdo/estado pela ferramenta.

### 12.2 Leitura protegida e concorrência

Uma futura leitura executada requer somente `LEVEL_DRIVE_LAB_STATE_DIR`, mantendo o diretório já
vinculado ao laboratório. Não aceitar destino alternativo para contornar falhas. O operador precisa
parar todos os comandos capazes de alterar o laboratório e confirmar isso na sessão com
`LEVEL_DRIVE_LAB_DIAGNOSE_QUIESCENT=true`. A confirmação não substitui a autorização humana.

O leitor reutiliza `validateExternalPath()`, `assertPrivatePermissions()`, `DriveLabState.read()` e
`readPrivateJson()`: caminho externo, arquivo regular de link único, sem symlink/junction/UNC, ACL privada,
JSON limitado, schema do estado e envelope com checksum. Não enfraquece nem corrige ACL automaticamente.
Diretório deve conter exatamente journal e claim; lock, temporário, arquivo ausente ou desconhecido bloqueia
antes de abrir conteúdo privado. Lock ativo e lock órfão recebem a mesma recusa: nada é removido.

Há três snapshots do diretório e dos dois arquivos, envolvendo duas leituras completas e validadas.
Snapshots verificam nomes, ausência de lock, identidade dos arquivos, modo/proprietário/link count,
tamanho, criação, ctime e mtime. Os campos ficam somente em memória. O leitor privado existente verifica
também identidade e estabilidade durante cada leitura. Os dois pares de conteúdo e os três snapshots
precisam concordar; qualquer troca, escrita, mudança de ACL ou sinal de concorrência bloqueia sem retry.
atime fica fora da comparação porque uma leitura pode atualizá-lo.

**Limite:** ausência de lock e snapshots estáveis não constituem exclusão mútua ou snapshot transacional.
Sem criar lock não é possível impedir um escritor de iniciar após a última observação, nem demonstrar
ausência absoluta de outro processo. O protocolo depende de repouso confirmado pelo operador e de
escritores cooperativos; qualquer dúvida impede uso operacional. Usuário local/administradores e a
resolução temporal do filesystem continuam parte da fronteira de confiança.

### 12.3 Consistência e contrato da saída

Além do schema existente, exige criação reservada, pelo menos uma aprovação consumida e claim com
as quatro chaves exatas. Operação, cliente e proprietário devem coincidir privadamente com o journal.
`RESERVED`/`BLOCKED` exigem tentativa falsa, referências nulas e uma única aprovação consumida.
`UNCERTAIN` exige tentativa verdadeira e referência da raiz; a referência de pasta pode faltar.
`CREATED` exige tentativa e ambas as referências. Combinações incompatíveis são recusadas.

| Campo | Significado em diagnóstico válido |
| --- | --- |
| `integrityValid` | Schema, checksum, consistência e requisitos adicionais passaram. Não é assinatura digital. |
| `phase` | Uma das quatro fases persistidas e validadas. |
| `createAttempted` | Intenção durável registrada; true não comprova envio da requisição. |
| `rootReferencePresent` | Existe referência válida da raiz, sem revelar seu valor. |
| `folderReferencePresent` | Existe referência válida da pasta, sem revelar seu valor. |
| `claimMatchesJournal` | Claim exato e seus três vínculos concordam com o journal. |
| `approvalConsumed` | Há registro de consumo no journal associado à reserva com claim válido. Não identifica nem revalida um arquivo de aprovação específico. |
| `stateStable` | As leituras e snapshots concordaram durante a janela observada. Não impede alterações posteriores. |
| `remoteCreationProven` | false para `RESERVED`/`BLOCKED`; `UNKNOWN` para `UNCERTAIN`, mesmo com referência de pasta; true somente para `CREATED`. |

O último campo representa **evidência histórica local**: `CREATED` registra a conclusão das inspeções
do motor existente. Não prova existência atual no Drive, ausência de revogação, segurança atual da ACL,
nem resiste a adulteração/rollback por usuário local confiável. false diz apenas que esta reserva não
registrou intenção de envio; não é inventário remoto nem prova global de inexistência de pastas.
Sem abrir a aprovação ou os arquivos OAuth/identidade, o diagnóstico não verifica o approvalId
operacional específico, o stateBinding daquela aprovação, a conta atualmente autorizada ou a validade
da concessão. Confere somente os vínculos concordantes entre os dois arquivos locais selecionados.

Qualquer falha devolve exit code 1 e somente os mesmos nove campos em stderr:
`integrityValid=false`, `stateStable=false` e os demais `UNKNOWN`, inclusive `phase`.
false nesses dois campos significa validação/estabilidade não comprovada; a ferramenta não publica
diagnóstico parcial. Não imprime mensagem, code ou stack da exceção. Sucesso/preview usa stdout e code 0.
Nem falha nem sucesso consomem aprovação ou modificam fase, journal, claim ou lock.

### 12.4 Procedimento supervisionado futuro — não executado

1. Obter validação desta implementação e autorização específica para ler somente o journal/claim real.
2. Confirmar baseline, ambiente sem debug/transcrição, diretório privado original e comandos operacionais parados.
3. Configurar privadamente apenas o diretório de estado e declarar repouso com a variável indicada acima.
   Não imprimir ambiente, caminhos ou conteúdo JSON. Não mudar ACL para fazer o diagnóstico passar.
4. Conferir o preview. Somente depois da autorização usar a flag de execução do comando **de diagnóstico**.
   O comando preparado seria `npm.cmd run --silent drive:lab-diagnose -- --execute`; não foi executado nesta entrega.
5. Guardar somente os nove campos sanitizados. Em falha, preservar todos os arquivos e solicitar revisão;
   não retirar lock, resetar journal, regenerar aprovação ou repetir criação.
6. `BLOCKED` com tentativa falsa direciona investigação às etapas anteriores à criação. `UNCERTAIN`
   exige tratar a criação remota como possível. `CREATED` constitui evidência histórica local.
   Nenhum resultado identifica sozinho qual chamada produziu o 404 nem autoriza consulta Google.
7. Avaliar separadamente eventual reconciliação remota de leitura. O `lab-inspect` existente começa
   pela raiz e grava consumo/journal localmente, portanto não é substituto deste diagnóstico sem escrita.

## 13. Relatório técnico do Marco 04B.3B.18.17

| Inventário | Alteração |
| --- | --- |
| Criado: `src/drive-lab-diagnose.mjs` | CLI e leitor somente de leitura, sem reutilizar writers/locks. |
| Criado: `test/drive-lab-diagnose.test.mjs` | Fixtures inventadas, filesystem temporário e verificações negativas/preservação. |
| Modificado: `package.json` | Apenas script `drive:lab-diagnose`, sem novas dependências. |
| Modificado: `README.md` | Entrada do novo comando e referência ao contrato. |
| Modificado: `GOOGLE_DRIVE_LAB.md` | Runbook, limites da evidência e relatório desta etapa. |

Os 547 testes anteriores e os módulos de criação/OAuth/identidade/preparador/publicação permanecem
intactos. A preservação contra `91c725f` é verificada também pelo novo teste D17.

### 13.1 Evidências finais

| Validação | Resultado |
| --- | --- |
| `npm.cmd run check` | Sintaxe válida em **31 arquivos**. |
| `npm.cmd test` | **603/603 aprovados: 547 anteriores + 56 novos**; zero falhas, cancelados, skips ou TODOs. |
| `npm.cmd run drive:lab-diagnose` | Preview com exatamente nove campos, `phase=DRY_RUN` e demais valores `UNKNOWN`. |
| `git diff --check` | Sem erros de whitespace. Avisos LF/CRLF de checkout não alteram o resultado. |
| `git status --short --branch` | Branch preservada e somente os cinco arquivos do inventário pendentes. HEAD continua `91c725f`. |
| D17 e preservações históricas | Arquivos protegidos de todos os baselines anteriores, testes e módulos operacionais intactos. Package mantém todos os scripts e dependências anteriores. |
| Varredura textual limitada | Cinco arquivos públicos desta entrega inspecionados; zero ocorrências dos padrões selecionados de credenciais. Nenhum arquivo privado inspecionado. |

Trecho final da execução completa, duração de teste pública (não é timestamp privado):

```text
tests 603
pass 603
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 282691.7913
```

| Cobertura nova | Evidência |
| --- | --- |
| D01–D02 | Dry-run anterior a ambiente/IO/rede/SDK e flags recusadas sem eco. |
| D03 | Cinco cenários reais de filesystem temporário: quatro fases e UNCERTAIN com/sem referência de pasta. |
| D04–D06 | Vínculos divergentes, schema/checksum inválidos, JSON parcial, consumo e combinações ambíguas. |
| D07–D10 | Lock ativo/órfão e itens inesperados antes de abrir bytes; confirmação de repouso; paths, junction/symlink, hardlink e ACLs inseguras. |
| D11–D13 | Troca de conteúdo/metadados entre passagens; escrita, substituição, alteração de ACL e lock transitório no filesystem; mudança dentro da leitura privada. |
| D14–D16 | Somente quatro aberturas O_RDONLY dos dois arquivos sintéticos; mutadores/writers/lock/rede proibidos; bytes preservados; stdout/stderr limitados aos nove campos; sem retry automático. |
| D17 | Preservação de todo o baseline 91c725f, incluindo testes anteriores; apenas um script adicionado ao package. |

A primeira tentativa da suíte nova na sandbox não validou o filesystem privado: houve
`PRIVATE_PATH_UNAVAILABLE` e falhas em cascata ligadas à restrição de acesso/ACL. A repetição autorizada
fora da sandbox, sem alterar os validadores ou abrir permissões para contornar a restrição, passou
55/56 testes. A falha restante era a fixture D11: o caso de alteração de conteúdo produzia um estado
semanticamente inválido antes de alcançar a comparação de estabilidade. A fixture foi corrigida para
usar um estado UNCERTAIN válido; as asserções negativas de JSON/checksum e diretório foram reforçadas.
A execução completa posterior, fora da sandbox, passou 603/603. Nenhum teste anterior foi modificado.

ACLs abertas nos casos negativos existem somente em temporários sintéticos para demonstrar recusa.
O setup dos demais temporários usa ACL privada; o teardown confere diretório/prefixo antes de remover
somente o scratch criado pelo teste. As suítes históricas preservadas incluem servidores loopback
simulados; o diagnóstico novo não inicia servidor nem conexão de rede. Não houve processo CLI do
diagnóstico com `--execute`: os caminhos executados foram testados por chamadas programáticas com
fixtures, inclusive testes de dispatch/parser. Não foi lido LabState real.

### 13.2 Limitações e aceite pendente

Os limites de concorrência, confiança no armazenamento local, significado histórico do campo remoto,
impossibilidade de revalidar aprovação/conta e impossibilidade de localizar a chamada exata do 404
estão descritos na seção 12. O diagnóstico não reconcilia, reabre ou libera a criação.
A varredura textual de cinco arquivos é limitada a padrões: não é auditoria universal, não inspeciona
os seis binários históricos, arquivos privados, histórico completo ou backups.

Resultado desta etapa: implementação e testes locais concluídos, aguardando validação do responsável.
**Nenhum arquivo privado real foi lido; nenhuma aprovação operacional foi gerada; LabState real não
foi alterado; nenhuma chamada Google ou criação remota foi realizada.** Não houve alteração de escopo,
dependências, motor de criação/publicação, frontend, RSVP, QR, Access Pass, check-in ou Service Worker.
Não houve commit, push, merge ou deploy. O diagnóstico operacional exige autorização posterior.

## 14. Preflight Google Drive somente de leitura

O comando independente `drive:lab-preflight` consulta metadados remotos somente quando explicitamente
autorizado. Não usa o journal/claim, não consome aprovação de criação e não libera criação ou publicação.
As regras das seções anteriores para `lab-create`, `lab-inspect` e `lab-diagnose` continuam próprias
daqueles comandos; o preflight não substitui suas aprovações.

### 14.1 Comandos e confirmação

Em `tools/live-experience-local/`, os comandos seguros de preview são:

```powershell
npm.cmd run drive:lab-preflight
npm.cmd run drive:lab-preflight -- --dry-run
```

O dry-run é padrão e precede acesso ao ambiente, arquivos privados, ACL, SDK e rede. Para uma futura
operação real, a autorização humana específica deve anteceder tanto a flag `--execute` quanto a
confirmação `LEVEL_DRIVE_LAB_PREFLIGHT_CONFIRMED=true`. A flag isolada não basta. Credenciais Desktop
e tokens existentes são indicados por `LEVEL_DRIVE_CREDENTIALS_FILE` e `LEVEL_DRIVE_TOKEN_DIR`, em
caminhos privados externos ao repositório. Não registrar seus valores ou conteúdos no Git/terminal.
Nesta entrega não se executa a CLI contra o Google nem se configura uma autorização operacional.

### 14.2 Consultas, transporte e saída

Depois de validar caminhos, ACL, cliente, escopo `drive.file`, grant e validade do access token, o
preflight prevê, nesta ordem, no máximo três consultas de dados, todas GET:

1. `files.get`: metadados de `root`, com `LAB_METADATA_FIELDS`.
2. `permissions.list`: permissões do ID retornado pela raiz, `pageSize=100`, campos fixos.
3. `files.list`: busca não recursiva de itens não excluídos com
   `appProperties.levelXVIIILab=LAB_TAG`, `pageSize=3`, campos fixos.

Não há busca de páginas adicionais. Resposta incompleta, `nextPageToken`, busca incompleta, erro HTTP,
expiração ou timeout bloqueiam na etapa corrente e impedem consultas seguintes. O limite é de 15 s
por consulta, com abort; não é um deadline global de 15 s. Retries e redirects ficam desabilitados.
A guarda de transporte recusa destinos externos, métodos diferentes de GET e `alt=media`.

O interceptor força `redirect='error'`, opção Fetch efetivamente usada no transporte instalado
(`googleapis` 189.0.0, `gaxios` 8.3.2 e `node-fetch` 3.3.2). A regressão F13 mantém SDK, Gaxios e
node-fetch reais e substitui somente `http.request`/`https.request` por respostas em memória. Seu
controle sem a guarda segue um redirect; com o preflight, respostas 301/302/303/307/308 para destino
externo ou `alt=media` provocam bloqueio após uma única requisição, sem atingir o destino indicado.
Não basta verificar a presença de uma opção em mocks do SDK; repetir essa regressão ao atualizar dependências.

O token precisa ter mais de seis minutos de validade restante e o grant mais de um minuto. Não há
renovação automática, persistência de tokens, escrita de estado, criação, upload ou download de mídia.
Segredo Desktop e refresh token são lidos para validar o envelope existente, mas não são repassados
ao cliente do preflight; ele recebe somente access token, expiração e tipo. Métodos de refresh são bloqueados.

A saída contém somente campos fixos de modo, etapa, código, escopo e efeitos. Não imprime IDs,
URLs privadas, credenciais, tokens, hashes ou exceções brutas. Falhas não incluídas na lista pública,
inclusive redirects e indisponibilidade de caminho privado, viram `VALIDATION_OR_ACCESS_FAILED`.
`googleContacted=true` indica tentativa de consulta, não prova de que o Google recebeu a requisição.
`PREFLIGHT_READS_COMPLETED` indica conclusão das leituras, não homologação de conta, ACL remota ou publicação.

### 14.3 Testes offline e limite do sandbox no Windows

Com Node.js 24 e dependências instaladas, executar em `tools/live-experience-local/`, fora do sandbox
quando este restringir os ancestrais do temporário:

```powershell
# Suíte completa; remove DEBUG somente da cópia do ambiente destinada ao processo filho.
node --input-type=module -e "import {spawnSync} from 'node:child_process'; const env={...process.env}; delete env.DEBUG; const result=spawnSync(process.execPath,['--test','test/drive-lab-preflight.test.mjs'],{env,stdio:'inherit'}); process.exit(result.status??1);"
```

Para executar somente a regressão de redirects, acrescentar `'--test-name-pattern=^F13'` ao array
de argumentos, entre `'--test'` e o arquivo. Não alterar variáveis globais ou enfraquecer os validadores.
Outras configurações inseguras de logging/TLS continuam sujeitas às recusas existentes.

No Windows deste ambiente, o F12 isolado falhou dentro do sandbox: `fs.realpath` retornou `EPERM`
em um ancestral de `TEMP`, antes de verificar a ACL e abrir a fixture de credenciais. A sequência
foi `PRIVATE_PATH_UNAVAILABLE` na leitura privada e `VALIDATION_OR_ACCESS_FAILED` na etapa `AUTH`.
Fora do sandbox, o mesmo F12 passou; a suíte anterior à regressão F13 passou 64/64, sem falhas.
`TEMP`, `TMP` e `os.tmpdir()` coincidiam; não se identificaram links simbólicos nos ancestrais fora
do sandbox. O bloqueio foi do ambiente de execução, não evidência de ACL incorreta na fixture.

Somente o setup do F12 cria credenciais/tokens sintéticos e aplica ACL privada ao seu novo diretório
temporário. O teardown verifica diretório/prefixo antes de remover o scratch. Permissões, credenciais
e configurações existentes ficam preservadas. Os testes verificam mocks, SDK com transporte simulado,
filesystem local e baselines Git (F11); não demonstram integração real com o Google Drive.

Validação após bloquear redirects: F13 isolado **12/12**, suíte completa **76/76**, zero falhas,
cancelamentos ou testes ignorados, ambos fora do sandbox e sem `DEBUG` no processo filho. F11 e F12
passaram; nenhuma chamada Google real foi executada.
