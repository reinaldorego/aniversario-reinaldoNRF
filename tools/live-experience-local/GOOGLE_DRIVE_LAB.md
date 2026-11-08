# Laboratório Drive — Marco 04B.3B.11

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
