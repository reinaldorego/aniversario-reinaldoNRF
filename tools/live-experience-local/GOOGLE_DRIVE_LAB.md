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
