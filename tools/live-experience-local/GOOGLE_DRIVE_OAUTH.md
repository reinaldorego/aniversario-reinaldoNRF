# Google Drive OAuth local — Marco 04B.3A

**Estado:** implementação de preparação autorizada; conexão real NÃO autorizada nem executada. Base: `feature/live-experience`, `d9c92e8`. Evento: **28/11/2026 às 21h em Belém/PA (UTC−03)**.

Conta exclusiva, projeto `level-xviii-live-2026`, API ativada, OAuth External/Testing, cliente Desktop v2 e pastas privadas são informações fornecidas pelo responsável. Não foram inspecionados no Google. Nenhuma credencial real foi lida, copiada ou registrada e nenhuma pasta Cloud/Drive foi criada neste marco.

## 1. Separação de responsabilidades

| Arquivo | Função |
| --- | --- |
| `src/drive-cli.mjs` | Parse estrito, dry-run antes de efeitos e comandos independentes. |
| `src/drive-auth.mjs` | SDK oficial, Desktop OAuth, PKCE, callback loopback, renovação e revogação. |
| `src/drive-token-store.mjs` | Caminhos externos, proteção de permissões, JSON privado e tokens locais. |
| `src/drive-connection.mjs` | Consulta mínima e leitura de fixtures sintéticas por manifesto privado. |

Os quatro módulos não importam motor, armazenamento do simulador, fonte simulada ou API de publicação. Não existe ponte para `Simulator`, índices, checkpoints ou estados publicados. A trava `ONLY_SYNTHETIC_CLIENT_SUPPORTED` de `DriveSource` continua intacta. Nenhum método de criação, atualização, exclusão ou compartilhamento de arquivos Drive é disponibilizado pela CLI.

`01_ORIGINAIS`, `02_PUBLICAR_NA_GALERIA` e `03_RETIRADAS` reais não são parâmetros desta etapa. Não configurar seus IDs no manifesto de teste. Convite, frontend, RSVP, Access Pass, QR, check-in, planilha, Apps Script, Service Worker, manifest e Documento Mestre permanecem preservados.

## 2. Dependência e ambiente

- Node **v24.21.0**, npm **11.19.0**; não atualizados neste marco.
- Dependência direta única: SDK oficial **googleapis 189.0.0**. Exige Node >=22, compatível com o Node 24 já instalado.
- Transitivas principais resolvidas: **google-auth-library 11.3.3**, **googleapis-common 9.3.1**, **gaxios 8.3.2**. A árvore completa, integridades e URLs do registro estão em `package-lock.json`.
- Instalação sem scripts: `npm.cmd ci --ignore-scripts`. Esse comando consulta o registro npm, não autentica no Google. Não confundir instalação de pacote com ensaio OAuth.
- Uma instalação inicial em sandbox recebeu EACCES; a repetição autorizada fora dele instalou 45 pacotes. A auditoria da instalação informou zero vulnerabilidades. Houve aviso transitivo de depreciação de `node-domexception@1.0.0`; nenhuma substituição/atualização automática foi feita.

## 3. Comandos e dry-run

Executar a partir de `tools/live-experience-local/`. Todos os comandos abaixo são previews seguros por padrão:

```powershell
npm.cmd run drive:diagnose
npm.cmd run drive:authorize
npm.cmd run drive:connectivity
npm.cmd run drive:read-synthetic
npm.cmd run drive:revoke
npm.cmd run drive:clean-local
```

`-- --dry-run` é equivalente ao padrão. O retorno acontece antes de carregar o SDK, examinar arquivos ou permissões, ler segredos, iniciar processo auxiliar, criar socket, abrir navegador, usar rede ou gravar tokens. Só informa nomes de comandos, escopo fixo, presença de variáveis e ausência de efeitos; não informa seus valores/caminhos. Argumentos desconhecidos/duplicados são rejeitados sem reproduzi-los na saída.

`-- --execute` desativa o preview daquele comando. **A flag não substitui a aprovação humana para o 04B.3B. Não executar os comandos Google reais antes dela.**

| Comando com `-- --execute` | Efeito futuro |
| --- | --- |
| `drive:diagnose` | Somente metadados locais/ACL e disponibilidade do SDK. Não lê conteúdo de credenciais/tokens, não inicia OAuth e não abre navegador/rede. |
| `drive:authorize` | Lê o JSON externo em runtime, abre navegador do sistema, recebe callback e troca código; salva tokens externos após validação. Não acessa arquivos Drive. |
| `drive:connectivity` | Usa autorização existente, podendo renovar access token; consulta no máximo um recurso com marcador sintético. Não inicia login. |
| `drive:read-synthetic` | Usa manifesto externo e autorização existente; lê apenas fixtures listadas, sem persistir bytes. Não inicia login. |
| `drive:revoke` | Revoga remotamente o refresh token e depois remove o arquivo local. Não precisa ler o JSON de credenciais. |
| `drive:clean-local` | Limpeza offline do arquivo fixo de tokens, com validação de caminho/propriedade. Não carrega SDK nem credenciais e não revoga consentimento remoto. |

Não existe comando de upload, criação de pasta, publicação, sincronização real, alteração de ACL ou ampliação de escopo. `start`, `seed` e demais comandos anteriores continuam apenas no simulador local.

## 4. Configuração externa e proteção local

Valores são caminhos absolutos, definidos só na sessão futura do operador; não criar `.env` com dados reais no repositório:

| Variável | Conteúdo esperado |
| --- | --- |
| `LEVEL_DRIVE_CREDENTIALS_FILE` | Caminho do JSON Desktop já guardado fora do repositório. Não aceita credencial inline ou ADC. |
| `LEVEL_DRIVE_TOKEN_DIR` | Diretório privado existente, dedicado e externo para `drive-oauth-tokens.json`. |
| `LEVEL_DRIVE_TEST_MANIFEST` | JSON privado de allowlist sintética; necessário somente para `read-synthetic`. |

Exemplo de configuração com placeholders, a preencher somente após aprovação, sem colar conteúdos JSON:

```powershell
$env:LEVEL_DRIVE_CREDENTIALS_FILE = 'CAMINHO_ABSOLUTO_EXTERNO_DO_JSON_DESKTOP'
$env:LEVEL_DRIVE_TOKEN_DIR = 'DIRETORIO_ABSOLUTO_EXTERNO_PRIVADO'
$env:LEVEL_DRIVE_TEST_MANIFEST = 'CAMINHO_ABSOLUTO_EXTERNO_DO_MANIFESTO_SINTETICO'
```

O código rejeita arquivos/diretórios no repositório ou diretórios ancestrais dele, caminhos relativos/UNC, junctions/symlinks em qualquer componente, hardlinks de arquivos, tipos não regulares, JSON acima de 64 KiB e caminhos ambíguos/dispositivos/ADS no Windows. Não cria diretórios de segredos automaticamente. A leitura verifica identidade/tamanho/horários do arquivo; não segue links como atalho para a validação.

No Windows, consulta ACL/owner sem imprimir seus dados. Só aceita permissões Allow para usuário atual, SYSTEM e Administradores locais; direitos administrativos da máquina são parte da fronteira de confiança. No POSIX, exige proprietário atual e ausência de permissões de grupo/outros. `0600` sozinho não comprova ACL privada no Windows.

Procedimento futuro: criar um diretório novo, vazio e dedicado fora de qualquer árvore servida por HTTP, pasta compartilhada ou sincronização pública. Em Propriedades → Segurança → Avançado, revisar owner e limitar herança/Allow aos três principais confiáveis descritos acima. Aplicar também ao arquivo Desktop existente, sem copiá-lo para o Git. Não aplicar alterações de ACL à pasta pessoal inteira ou a uma instalação existente. O diagnóstico local recusará a configuração caso não possa verificar a privacidade. A inspeção do conteúdo do arquivo não é necessária para essa preparação.

Tokens ficam em JSON privado protegido pela ACL; não há criptografia própria de cofre. Arquivos temporários recebem ACL privada antes dos bytes, são sincronizados e renomeados atomicamente. Limpeza só remove o arquivo fixo e com envelope reconhecido; não apaga diretórios, credenciais, manifestos ou originais. Conteúdo desconhecido/corrompido é preservado para revisão. Não há garantia de apagamento físico em SSD, backups ou memória do processo. Não executar duas instâncias OAuth simultâneas no mesmo diretório.

`.gitignore` acrescenta defesa para `.env*`, nomes usuais de credenciais, tokens/temporários e PEM; isso não autoriza guardar segredos no Git. Arquivos já rastreados não seriam protegidos pelo ignore. `node_modules/` continua ignorado; o lockfile deve ser versionável, sem commit nesta etapa.

## 5. OAuth Desktop e confidencialidade

Solicita somente `https://www.googleapis.com/auth/drive.file`. Não solicita `openid`, perfil/e-mail, `drive.readonly`, `drive.metadata.readonly` ou Drive completo. Não há parâmetro de escopo nem `include_granted_scopes` automático. Resposta sem escopo ou com escopo adicional é recusada, preservando arquivo anterior.

Usa Authorization Code Flow, `access_type=offline`, consentimento explícito e seleção de conta. PKCE **S256 obrigatório**: verifier de alta entropia gerado pelo SDK oficial, challenge conferido localmente e verifier enviado apenas na troca. Se a biblioteca não suportar PKCE, o fluxo para antes do navegador; não usa fallback sem PKCE. `state` aleatório de 256 bits, comparação em tempo constante para valores de mesmo comprimento, timeout e consumo único.

Listener só em **127.0.0.1**, porta efêmera, rota `/oauth2/callback`, GET, Host exato e sem Origin. Nega callback externo, state ausente/incorreto, parâmetros duplicados, código ausente e replay. O listener fecha em sucesso, recusa, timeout ou falha; respostas locais não refletem query/código/state. Não usa OOB, localhost por nome, interface pública, túnel ou servidor do simulador.

JSON Desktop só é lido em execução explícita. Endpoints do arquivo são validados contra Google, sem aceitar transportes/redirects arbitrários do JSON. O arquivo inteiro nunca é enviado. Na futura autorização aprovada, o SDK usa os campos OAuth necessários nos endpoints oficiais do Google; a URL de consentimento vai somente ao navegador do sistema. Nenhuma URL de autorização, código, verifier, segredo, resposta bruta, stack ou cabeçalho é impresso, copiado para clipboard ou registrado pelo aplicativo. Se o navegador falhar, não imprime URL como fallback.

Execução efetiva é bloqueada se houver configuração de debug/log de SDK/Node, inspeção/carregadores/tracing por opções Node, keylog ou TLS sem verificação. Executar sem transcrição de terminal, captura de tela do consentimento, debugger ou logging HTTP externo. O sistema operacional, navegador, usuário local e administradores continuam parte da fronteira de confiança; o aplicativo não impede instrumentação hostil antes de seu início.

## 6. Conectividade e leitura controlada

`connectivity` faz `files.list` com `pageSize=1`, campos mínimos e query restrita à `appProperties.levelXVIIITest=04B3B-synthetic-v1`. Não lista a conta inteira nem imprime IDs. Resultado `NO_AUTHORIZED_SYNTHETIC_FILES` indica resposta da API sem recurso sintético visível: **não demonstra pasta vazia, permissão editorial ou visibilidade de todos os arquivos**. Respostas parciais/incompleteSearch são recusadas. Não pagina o acervo de produção.

`read-synthetic` exige manifesto privado válido antes de renovar token. Formato abaixo é esquema com placeholders, não uma configuração operacional:

```json
{
  "kind": "LEVEL_XVIII_SYNTHETIC_DRIVE_TEST_V1",
  "folderId": "ID_DA_PASTA_ISOLADA_CRIADA_PELO_APP",
  "files": [{ "id": "ID_DE_FIXTURE_SINTETICA", "bytes": 1024, "sha256": "SHA256_REAL_DA_FIXTURE_GEOMETRICA_64_HEX" }]
}
```

No futuro, pasta e arquivos precisam ter marcador `appProperties.levelXVIIITest=04B3B-synthetic-v1` no contexto do mesmo aplicativo. Exige `isAppAuthorized=true`, parent único esperado, não trashed, PNG, versão e tamanho esperado. No máximo três fixtures de até 1 MiB cada; sem recursão, atalhos, URLs ou nome de arquivo como autorização. Download em stream tem deadline, abort, limite durante consumo, SHA-256 e marcador sintético; destrói stream e descarta bytes. Reconsulta metadados e recusa alteração. Só retorna contagem/resultado sanitizados, sem mídia, hash ou IDs.

Marcador e checksum são controles de ensaio, não identidade humana ou certificação de ACL. Não usar fotografias pessoais com marcadores artificiais. A semântica real dos campos/respostas, inclusive defaults omitidos, streaming/cancelamento e visibilidade por escopo ainda deve ser verificada no 04B.3B; a preparação falha fechada quando falta evidência.

## 7. Limite de drive.file e viabilidade editorial

**Uma pasta criada manualmente e seus arquivos descendentes, atuais ou futuros, NÃO ficam automaticamente acessíveis pelo escopo drive.file.** ACL da conta e autorização do aplicativo são controles diferentes. Saber o ID, compartilhar a pasta com a conta ou selecionar a pasta não comprova autorização para todos os filhos.

Alternativas a avaliar sem alterar o fluxo aprovado:

1. Arquivos criados pelo próprio aplicativo, em pasta isolada criada por ele: primeira prova de conectividade com privilégio mínimo.
2. Seleção/abertura explícita de arquivos específicos via Google Picker ou integração suportada: avaliar separadamente configuração, APIs necessárias e acesso por arquivo. Não habilitar APIs, criar clientes nem implementar Picker automaticamente neste marco.
3. Outro modelo de identidade/contexto dedicado e escopo mínimo: somente proposta futura, com aprovação específica, análise de verificação/custo e isolamento. A allowlist no código não reduz o consentimento OAuth de um escopo amplo.

O fluxo editorial aprovado continua: organizador/fotógrafo colocam arquivos em pasta controlada; após ACL/estabilidade/validação/derivados, publicação automática. **Se drive.file exigir escolha individual a cada nova foto, isso pode inviabilizar esse fluxo; não substituir silenciosamente a aprovação editorial por pasta por uma etapa Picker por foto.** Não ampliar escopo para resolver 403 ou lista vazia.

Matriz futura de viabilidade, sempre em isolamento e mediante autorização própria:

| Caso sintético | Prova necessária |
| --- | --- |
| Pasta e PNG criados pelo aplicativo | Visibilidade, leitura e marcador sob drive.file. |
| PNG adicionado manualmente na pasta de teste pelo organizador | Verificar se está autorizado ao aplicativo; não presumir herança. |
| PNG adicionado pelo fotógrafo | Repetir visibilidade e inspecionar a viabilidade de ACL/identidade. |
| Arquivo específico selecionado explicitamente | Verificar acesso somente ao arquivo e requisito para novas inclusões. |
| Pasta manual de teste e novos filhos | Demonstrar limites sem consultar/modificar as três pastas reais. |

Esta CLI não implementa criação/upload/Picker nem certificação de ACL real. A criação da pasta isolada pelo aplicativo e o mecanismo para alimentar fixtures serão trabalho explicitamente autorizado no 04B.3B. Conexão OAuth não vincula os dois publicadores OIDC/permissionId e não homologa publicação automática.

## 8. Expiração, erros, revogação e limpeza

External/Testing emite refresh tokens de **sete dias** quando há escopos Drive; a exceção para escopos básicos de identidade não se aplica. O código registra prazo conservador de sete dias desde o início da autorização (ou prazo menor informado pelo servidor). Não consulta/altera o status OAuth. Renovar access token não prolonga esse prazo.

Access token vencido pode ser renovado somente dentro de um comando Google explicitamente executado, com refresh token ainda válido; preserva o vínculo de cliente e escopo. Sem token, consentimento, refresh válido ou em `invalid_grant`/401/403, retorna erro sanitizado e nunca inicia login por conta própria. Não mexe em estado publicado, checkpoint, tombstones ou pastas reais. 403/404 não são interpretados como exclusão/inventário vazio; não há ampliação automática de acesso. Timeouts são limitados; não há scheduler ou retry operacional de publicação.

Após aprovação futura, `npm.cmd run drive:revoke -- --execute` solicita revogação e só depois limpa o arquivo local. Falha remota conserva o arquivo para nova tentativa/revisão. Pode tentar revogar mesmo após o prazo local de sete dias. Se Google já considerar o token inválido e não confirmar a operação, revisar a concessão na página de conexões da Conta Google e revogar manualmente; então usar `npm.cmd run drive:clean-local -- --execute` para limpeza offline deliberada. Limpeza local não substitui revogação remota. Não apagar JSON Desktop automaticamente.

Após encerrar: remover as três variáveis da sessão com `Remove-Item Env:LEVEL_DRIVE_CREDENTIALS_FILE`, `Remove-Item Env:LEVEL_DRIVE_TOKEN_DIR` e `Remove-Item Env:LEVEL_DRIVE_TEST_MANIFEST`, quando definidas. São caminhos de configuração, não eliminação de arquivos. Revisar backups/cópias privadas conforme política; nenhuma limpeza recursiva está implementada.

## 9. Estratégia proposta para 28/11/2026

Somente após ensaio real, comprovação editorial, gates de privacidade/publicação e aceite operacional:

- Ensaiar consentimento, renovação, revogação e recuperação com fixtures, incluindo conta correta e permissões negadas.
- Realizar novo consentimento supervisionado em **26–27/11**, com margem para toda a operação de 28/11 às 21h e madrugada de 29/11. Revalidar antes de abrir; não depender de um token emitido em 07/11.
- Registrar privadamente prazo/operador, sem tokens. Manter operador disponível, MFA e navegador da conta exclusiva preparados. Reautorização continua ação explícita; não tentar login automático no meio de falha.
- Se consentimento/permissões falharem, preservar originais privados e operação do convite. A conexão não ativa publicação. O backend futuro deve seguir pausa/frescor/contingência da arquitetura, sem tornar o Drive público.
- Definir renovação ou desligamento do conector após o evento, retenção e backup antes de operação prolongada. Não manter promessa de álbum por depender indefinidamente de Testing sem rotina comprovada.

Não alterar OAuth para Production nesta entrega. Essa decisão exige avaliação e aprovação separadas; não é condição implicitamente satisfeita pelo SDK ou pelos testes.

## 10. Critérios para autorizar 04B.3B

1. Revisão desta implementação e regressão completa aprovadas; nenhum segredo no diff/arquivos rastreados ou ignorados.
2. Autorizar expressamente login da conta exclusiva, troca/armazenamento de tokens e consultas sintéticas; confirmar usuário de teste e cliente Desktop sem divulgar credenciais.
3. Validar os caminhos/ACLs privados e o runbook de revogação/limpeza, com operador responsável e sem debug/transcrição.
4. Aprovar criação pelo aplicativo de **uma pasta isolada de teste**, quantidade/limite de fixtures e mecanismo de criação; essa funcionalidade ainda não está implementada.
5. Aceitar o escopo único drive.file e o plano de demonstração da viabilidade editorial. Escopos adicionais permanecem proibidos sem aprovação específica.
6. Manter três pastas reais, fotos pessoais, publicação, integração frontend e RSVP fora do ensaio. Login bem-sucedido não libera produção.
7. Registrar apenas evidências sanitizadas: resultado, instante, validade, campos observáveis e pendências. Sem URLs de consentimento, códigos, IDs pessoais ou tokens.

## Referências oficiais

- [OAuth Desktop, PKCE e loopback](https://developers.google.com/identity/protocols/oauth2/native-app).
- [Expiração de refresh tokens e Testing](https://developers.google.com/identity/protocols/oauth2).
- [Escopos Drive e acesso por arquivo](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
- [File v3: isAppAuthorized, appProperties e metadados](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).
- [SDK Node oficial](https://github.com/googleapis/google-api-nodejs-client).
- [Arquitetura do projeto](../../docs/ARQUITETURA_LIVE_EXPERIENCE.md), [plano](../../docs/PLANO_IMPLEMENTACAO.md) e [decisões](../../docs/REGISTRO_DECISOES.md), preservados como baseline histórica.
