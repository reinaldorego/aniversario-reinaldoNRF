# Validação — Marco 04B.3A

**Entrega:** preparação segura da conexão Google Drive, implementada sob autorização expressa. Branch `feature/live-experience`, HEAD preservado `d9c92e8`. Base inicial limpa, com 101 testes. Festa: **28/11/2026 às 21h em Belém/PA**.

**Limite desta evidência:** testes com fixtures/identidades inventadas, clientes em memória, SDK com transporte substituído e HTTP apenas loopback. Nenhum login, consentimento, acesso ao Drive real, criação Cloud/Drive, foto pessoal ou credencial real. Acesso externo nesta implementação limitou-se ao registro npm para instalar/revisar a dependência e às referências técnicas públicas oficiais.

## 1. Arquivos entregues

Todos os caminhos abaixo pertencem a `tools/live-experience-local/`:

| Ação | Arquivo | Finalidade |
| --- | --- | --- |
| Criado | `src/drive-auth.mjs` | SDK, OAuth Desktop, PKCE, state, callback, validade, renovação e revogação. |
| Criado | `src/drive-token-store.mjs` | Caminhos externos, ACL/permissões, JSON limitado, tokens atômicos e limpeza pontual. |
| Criado | `src/drive-connection.mjs` | Conectividade mínima e leitura de até três fixtures sintéticas por manifesto externo. |
| Criado | `src/drive-cli.mjs` | Seis comandos separados, parse estrito, dry-run padrão e saída sanitizada. |
| Criado | `test/drive-auth.test.mjs` | A01–A13: SDK offline, PKCE/escopo, erros, expiração e revogação. |
| Criado | `test/drive-connection.test.mjs` | C01–C10: ausência de arquivos autorizados, permissões, integridade, stream e cancelamento. |
| Criado | `test/drive-security.test.mjs` | S01–S14: efeitos proibidos em dry-run, callback, filesystem/ACL, logs e preservação. |
| Criado | `test/drive-oauth-fixtures.mjs` | Somente credenciais/tokens claramente inventados e clientes simulados. |
| Criado | `package-lock.json` | Versões exatas, integridades e registro das transitivas. |
| Criado | `GOOGLE_DRIVE_OAUTH.md` | Runbook, limites, evento, ensaio editorial e gates 04B.3B. |
| Criado | `VALIDACAO_MARCO_04B_3A.md` | Este relatório. |
| Modificado | `package.json` | Dependência direta oficial fixada e seis scripts Drive independentes. |
| Modificado | `.gitignore` | Defesa para arquivos de segredos e temporários de tokens; node_modules continua ignorado. |
| Modificado | `README.md` | Instalação/estado atual e ligação para os documentos novos, preservando histórico. |

Nenhum arquivo de produção ou documento de arquitetura/Mestre foi alterado. Motor, CLI padrão, codec, fonte local, HTTP do simulador, DriveSource simulado, testes antigos e baseline de preservação permanecem intactos. O código OAuth não importa esses componentes nem expõe métodos de escrita Drive.

## 2. Comandos executados e resultados

Executados na pasta do módulo, exceto verificações Git na raiz:

| Validação | Resultado |
| --- | --- |
| `npm.cmd run check` | **20 arquivos JavaScript** com sintaxe válida. |
| `npm.cmd test` | **218 testes/subtestes aprovados**, zero falhas, cancelamentos, skips ou TODO. Última execução completa: aproximadamente 32,8 s, sem alegação de benchmark de produção. |
| Regressão 04B.1/04B.2 | **101 testes anteriores preservados e aprovados**; 117 novos testes/subtestes. |
| Scripts Drive, sem flags | Os seis entrypoints reais retornaram `DRY_RUN`, `effects=NONE`. |
| `git diff --check` | Sem erros de whitespace. Git apenas avisa sobre conversão futura LF/CRLF no Windows. |
| Arquivos novos | Verificação adicional de whitespace por arquivo, sem adicioná-los ao index. |
| `git status --short --branch` | Branch original; somente os 14 arquivos desta entrega, sem commit. |
| Preservação | T12 valida hashes dos 31 arquivos preexistentes; S13 valida motor, fonte simulada e suítes antigas. Diff dos caminhos protegidos vazio. |
| Dependências | `npm.cmd ls --all`: árvore consistente; `googleapis 189.0.0`, auth 11.3.3, common 9.3.1, gaxios 8.3.2. |
| Lockfile | Formato 3, 45 pacotes transitivos/diretos instalados; todos com integridade e URL HTTPS de `registry.npmjs.org`. |
| Auditoria npm da instalação | Zero vulnerabilidades conhecidas reportadas; não houve atualização automática de pacotes. |
| Ignore | node_modules, .env, nomes usuais de credenciais/client_secret, tokens/temporários e PEM correspondem às regras. Lockfile, fontes e testes ficam visíveis ao Git. |
| Revisão de segredos | Diff/arquivos novos revisados; busca de padrões conhecidos de credenciais reais sem ocorrências. Fixtures contêm apenas valores explicitamente sintéticos. Essa busca não substitui revisão humana. |

O ambiente restrito inicialmente negou acesso ao registro npm (EACCES) e resolução de ancestrais dos temporários (EPERM). Instalação e suíte completa foram repetidas com autorização de execução fora do sandbox; nenhuma permissão foi contornada por um transporte alternativo. Os testes só alteram diretórios temporários exclusivos, com limpeza verificada, e encerram seus listeners/processos.

Uma revisão adicional detectou que o bloqueio de tracing tratava opções passivas repassadas pelo test runner como tracing ativo. A regra foi corrigida e há regressão para essas opções, mantendo bloqueio de debug/inspeção efetivos. A revisão do SDK também revelou `retry:true` nos métodos OAuth; interceptor oficial agora aplica timeout de 15 s e retry desabilitado, comprovado com adapter simulado. Resultado final integral acima, sem falhas pendentes.

## 3. Evidências de segurança

| Grupo | Comprovado localmente |
| --- | --- |
| A01/A13 | Biblioteca instalada oficial gera PKCE; seu pipeline de troca usa verifier, timeout e ausência de retry, com transporte simulado e rede proibida. |
| A02–A04/A12 | State aleatório, S256, loopback, único escopo, ausência de fallback PKCE e recusa de URL/redirect adulterados. |
| A05–A07 | Consentimento recusado, timeout, invalid_grant/401/403/5xx, resposta incompleta ou escopos extras não substituem tokens anteriores. |
| A08–A11 | Renovação de access token sem login, prazo Testing não prolongado, vínculo de cliente, expiração/revogação, limpeza após confirmação remota. |
| C01–C03 | API sem arquivos autorizados não comprova pasta vazia ou acesso editorial; erro/permissão/partial não apagam estado. |
| C04–C07/C09 | Manifesto obrigatório antes de renovação, IDs restritos, autorização por arquivo, parent/marcador/tamanho/PNG/SHA-256 e limitação de bytes; sem persistir conteúdo. |
| C08/C10 | Alteração durante leitura, timeout de requisição e stream travado: rejeição, abort e destruição do stream. |
| S01–S03 | Todos os comandos dry-run bloqueiam filesystem/SDK/socket/rede/navegador; diagnóstico não lê segredos; limpeza local é independente do SDK. |
| S04–S06 | Parser negativo e listener real loopback: Host/Origin/método/rota/state, duplicação, replay, expiração e consentimento negado; respostas sem refletir dados. |
| S07–S12 | Caminhos internos/relativos/UNC/ADS/dispositivos, hardlinks, junctions/symlinks, ACL insegura, JSON excessivo/corrompido e endpoint externo rejeitados. ACL real Windows exercitada só em fixtures. |
| S13–S14 | Isolamento/preservação byte a byte, ausência de escrita Drive e bloqueio de debug/keylog/TLS inseguro antes de segredos. |

Fluxo editorial automático por pasta permanece aprovado conceitualmente, sem ponte para a conexão nova. Não houve alteração de estados publicados nem operação nas pastas reais `01_ORIGINAIS`, `02_PUBLICAR_NA_GALERIA` ou `03_RETIRADAS`.

## 4. Uso futuro e limitações

O [runbook OAuth](GOOGLE_DRIVE_OAUTH.md) contém comandos e variáveis de caminho externas. Todos os novos comandos começam em dry-run. `-- --execute` exige ação deliberada e não substitui autorização humana: **não executar Google real antes do aceite 04B.3B**.

Uma pasta manual e seus descendentes não recebem autorização automática de drive.file. Selecionar/compartilhar pasta não comprova acesso por arquivo. Esse escopo admite escrita em arquivos autorizados, embora esta CLI só ofereça leituras Drive; não é um escopo readonly. Se o fluxo editorial não for viável, registrar reprovação e propor alternativa, sem pedir drive.readonly, drive.metadata.readonly ou Drive completo automaticamente.

Não comprovados nesta entrega: login/consentimento real; seleção correta da conta; semântica real das respostas/defaults/escopos; pastas e arquivos criados/abertos pelo aplicativo; visibilidade efetiva de ACL e vínculo dos dois publicadores; operação real de streaming/revogação; cotas/rede/custo; publicação, leitura por código, integração mobile e operação para convidados. O marcador sintético não autentica humano nem certifica ACL.

O armazenamento de tokens é JSON privado sob ACL, sem criptografia própria de cofre ou lock entre vários processos. Executar um operador/comando por vez; SO, navegador, administradores e usuário local são confiáveis. As validações reduzem risco de links/troca de arquivos, mas não constituem isolamento contra administrador/local hostil. Não há garantia de apagar cópias em memória, SSD ou backup. Falha de revogação remota conserva o arquivo local; limpeza local isolada não revoga concessão Google.

Refresh tokens External/Testing com Drive expiram em sete dias. O código usa prazo conservador e não muda o status de publicação OAuth. A estratégia proposta é consentimento supervisionado em 26–27/11 e nova conferência antes de **28/11 às 21h em Belém**, com operador e recuperação ensaiada; isso não é homologação operacional nem autorização de produção.

## 5. Liberação de 04B.3B

Antes do primeiro login/Drive real, obter aceite explícito deste relatório, da conta/cliente exclusivo, dos caminhos/ACLs e do procedimento de revogação. Aprovar separadamente criação pelo aplicativo de uma pasta isolada e até três PNGs geométricos, manifesto privado, consultas e orçamento do ensaio. A funcionalidade de criação/upload ainda não está implementada.

Demonstrar acesso específico sob drive.file e testar, no isolamento autorizado, arquivos inseridos manualmente por ambas as pessoas; não presumir autorização recursiva. Avaliar Picker como alternativa específica sem transformar silenciosamente o fluxo aprovado em seleção por foto. Qualquer escopo adicional, mudança do status OAuth, consulta às pastas reais ou ligação com publicação exige nova aprovação.

Permanecem proibidos nesta entrega: autenticação/acesso Google reais, fotos pessoais, criação Cloud/Drive, mudança de frontend/credenciamento/SW/Documento Mestre e commit/push/merge/deploy. Nenhuma dessas ações foi executada.
