# Relatório técnico — Marco 04B.3B.11

**Entrega:** implementação local de laboratório sintético Drive, com criação única e inspeção controlada preparadas offline. **Situação:** aguardando validação final do responsável; operações Google reais continuam não autorizadas.

**Baseline confirmado:** `feature/live-experience`, HEAD `b97483f`, árvore inicialmente limpa, 218/218 testes anteriores aprovados. **Evento:** 28/11/2026 às 21h em Belém/PA. Nenhum commit, push, merge, deploy, provisionamento ou ativação de faturamento.

## 1. Leitura, autorização e limites

Foram lidos AGENTS.md, Documento Mestre, arquitetura, plano existente, runbook OAuth e implementação/testes locais. A auditoria inicial foi somente de leitura e apresentou plano. A implementação começou após a aprovação explícita desse plano pelo responsável, restrita aos sete arquivos novos e três existentes abaixo.

Não houve login OAuth real, conexão Drive, execução de processo CLI com `--execute`, criação/alteração/exclusão remota, mídia transferida ou leitura de acervo pessoal. Nenhuma das três pastas oficiais foi consultada. Nenhum arquivo privado de credenciais/tokens foi aberto ou alterado. Casos programáticos com execução habilitada usam exclusivamente dependências injetadas, transportes mockados e dados inventados; a flag é também verificada como dado no teste de parse.

Convite, frontend, RSVP, QR, Access Pass, check-in, Apps Script, Sheets, Service Worker, arquitetura, Documento Mestre, simulador e CLI OAuth foram preservados. A implementação não liga OAuth ou laboratório ao motor de publicação.

## 2. Inventário completo

Todos os caminhos abaixo são relativos a `tools/live-experience-local/`.

| Ação | Arquivo | Responsabilidade |
| --- | --- | --- |
| Novo | `src/drive-lab-cli.mjs` | Parse estrito, preview antes de efeitos, aprovação externa e sessão OAuth existente. |
| Novo | `src/drive-lab.mjs` | Única chamada de criação, provas de procedência, duas observações de metadados/ACL e reconciliação de leitura. |
| Novo | `src/drive-lab-state.mjs` | Aprovação consumível, vínculo ao diretório, lock exclusivo, claim permanente e journal com checksum. |
| Novo | `test/drive-lab-fixtures.mjs` | Identidades, aprovações, cliente Drive, estado e fixtures PNG exclusivamente sintéticos. |
| Novo | `test/drive-lab.test.mjs` | L01–L25, negativos, SDK com transporte simulado, concorrência e persistência privada. |
| Novo | `GOOGLE_DRIVE_LAB.md` | Contratos, procedimento futuro, bloqueios, plano de duas fixtures e condições para login. |
| Novo | `VALIDACAO_MARCO_04B_3B_11.md` | Este relatório, evidências e pendências. |
| Modificado | `package.json` | Somente dois scripts novos: `drive:lab-create` e `drive:lab-inspect`. |
| Modificado | `README.md` | Acrescenta referência e limites do laboratório. |
| Modificado | `GOOGLE_DRIVE_OAUTH.md` | Acrescenta nota de continuidade; distingue CLI OAuth histórica da nova CLI. |

Nenhuma dependência foi instalada/atualizada; `package-lock.json` preservado. Os quatro módulos OAuth originais, as cinco suítes anteriores, fixtures e motor permanecem byte a byte iguais ao baseline aplicável. O teste L20 verifica todos os **58 arquivos rastreados não autorizados para alteração**, incluindo os binários por checksum. Usa o baseline prévio de bytes para os 31 arquivos originais com LF/CRLF mistos e os blobs Git para os demais arquivos LF; não muda os finais de linha para fazer a verificação passar.

## 3. Implementado e testado offline

- Preview padrão e explícito sem ler configuração privada, credenciais, aprovação, estado ou permissões locais; sem carregar SDK, iniciar navegador, abrir socket, usar rede ou escrever.
- Registro privado exato de aprovação, action, approvalId de uso único, operationId, prazo máximo de uma hora, cliente, proprietário e vínculo ao diretório. Campos de destino/escopo extras são recusados.
- Um único diretório dedicado para a vida do laboratório; lock `wx` verificado entre instâncias e em processo filho. Sem desbloqueio/reset automático.
- Claim de criação não sobrescrevível e journal privado; intenção durável antes do envio. Ausência/corrupção/ambiguidade do estado bloqueia.
- Uma única chamada `files.create` por criação reservada, exclusivamente pasta de nome fixo na raiz `root` do My Drive. Sem mídia, parent editorial, Shared Drive ou compartilhamento.
- AppProperties próprios do laboratório, operação e tipo de recurso. Metadados da raiz e das ACLs conferidos antes do envio.
- Sem retry de criação em 401/403/404/429/5xx/timeout, resposta perdida/tardia/incompleta ou falha de persistência. O caminho de replay do OAuth SDK também foi testado com transporte simulado.
- Inspeção sem escrita remota: procedência do journal/claim, marcador, parent, proprietário, `isAppAuthorized` por recurso e até dois PNGs explicitamente allowlisted, de até 64 KiB cada.
- ACL com proprietário único, metadados completos, permissionIds e todas as páginas concordantes. Terceiros/leitores/escritores/group/domain/anyone, ancestral desconhecido e respostas indeterminadas são recusados.
- Paginação limitada, cursor repetido ou inválido recusado, `incompleteSearch` bloqueado, dupla observação para detectar alterações. Ausência de um arquivo esperado não é convertida em sucesso.
- Resultado sanitizado sem IDs, caminhos, contas, checksums privados, URLs OAuth, códigos ou tokens; sempre `descendantVisibility=NOT_PROVEN` e `editorialAccess=NOT_PROVEN`.

`drive.file` é o único scope. Um sucesso da inspeção comprova somente os recursos observáveis e allowlisted: não certifica visibilidade automática dos filhos nem homologa fluxo editorial ou publicação.

## 4. Evidências e validação

Comandos de validação em `tools/live-experience-local/`, exceto Git na raiz:

| Verificação | Resultado |
| --- | --- |
| `npm.cmd run check` | Aprovado: sintaxe válida em **25 arquivos**. |
| `npm.cmd test` | Aprovado: **388 testes/subtestes, 388 aprovados, zero falhas, cancelados, skips ou TODOs**. |
| Preservação | **218 anteriores + 170 novos**, sem editar as suítes anteriores. |
| `npm.cmd run drive:lab-create` | `DRY_RUN`, `effects=NONE`, sem mudança de publicação. |
| `npm.cmd run drive:lab-inspect` | `DRY_RUN`, `effects=NONE`, sem mudança de publicação. |
| Os dois comandos com `-- --dry-run` | Mesmo resultado seguro. |
| `git diff --check` | Aprovado; sem erros de whitespace. |
| `git status --short --branch` | Mesma branch, somente os três modificados e sete novos autorizados; nada staged. |
| Regressão L20 / S13 / T12 | Integridade dos arquivos protegidos, motor, fonte, OAuth e testes anteriores aprovada. |
| Auditoria textual de segredos | Nenhum segredo identificado pelos padrões utilizados; limites na seção 6. |

Resumo da execução final de `npm.cmd test`:

```text
tests 388
pass 388
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 54793.1164
```

Os testes não usam ADC, navegador real ou transporte Google. As suítes existentes fazem requisições **loopback locais** para testar callback e servidor do simulador; isso não é login ou acesso à internet. Os novos testes de rede/SDK usam mocks. Diretórios temporários criados pelos testes contêm somente dados inventados, recebem ACL privada e são removidos pontualmente pelo teardown após conferência de caminho.

### Cobertura dos novos testes

| Casos | Evidência |
| --- | --- |
| L01–L02 | Ausência de efeitos no dry-run; parse estrito e recusa de destino editorial/scope alternativo. |
| L03–L05 | Uma criação, raiz fixa, marcador, concorrência, duplicação, aprovação consumível e validação de limites. |
| L06–L08 | HTTP, timeout, resposta perdida/tardia/parcial, reconciliação sem novo create e mudança entre observações. |
| L09–L12 | ACL insegura/indeterminada em raiz/pasta/arquivo; autorização individual; zero, uma e duas fixtures; origem editorial recusada. |
| L13–L16 | Recurso anterior, falhas de persistência, sessão existente e saída sanitizada. |
| L17–L19 | Lock entre processos, persistência/reinício, estado/claim inválidos, lock/temporário órfãos, hardlinks e ACL aberta recusados. |
| L20–L21 | Integridade integral fora dos três arquivos autorizados; SDK oficial sem repetir create em erros HTTP. |
| L22–L25 | Falhas HTTP/timeout na inspeção, paginação, aprovação vencida durante preparação e envelope OAuth ampliado/expirado/ausente. |

### Falhas encontradas e resolvidas durante a validação

Na auditoria inicial, a sandbox impediu acesso aos temporários com ACL privada, gerando `PRIVATE_PATH_UNAVAILABLE` em teste que esperava `PRIVATE_PERMISSIONS_REQUIRED`. A repetição autorizada fora da sandbox aprovou os **218/218** anteriores. Não houve relaxamento de ACL, skip de teste ou alteração do controle de permissões. Os testes privados desta implementação usam esse ambiente de execução já autorizado.

A primeira integração do laboratório com filesystem encontrou claim sem os campos de procedência, por leitura do nível errado do objeto. A execução recusava o reinício com `LAB_STATE_INVALID`, mantendo o bloqueio. O registro foi corrigido para usar `creation.operationId/clientBinding/ownerPermissionId`; o teste de reinício e a regressão completa passaram depois da correção. Também foi corrigida a comparação nova de integridade para respeitar o baseline original de LF/CRLF, sem modificar arquivos protegidos.

## 5. Máquina de estados e tratamento de falhas

`RESERVED` consome a criação antes de SDK/rede. Antes do único envio, persiste `createAttempted=true` e `UNCERTAIN`. Depois da resposta e dupla inspeção completa, registra `CREATED`.

Falha antes da intenção de envio deixa `BLOCKED`; falha após intenção deixa `UNCERTAIN`. Crash em qualquer ponto não reabilita create. Novo approvalId, pasta renomeada ou inspeção bem-sucedida também não reabilitam criação.

Somente nova aprovação de `lab-inspect`, mesma operação/cliente/proprietário/diretório e intenção de envio existente podem reconciliar um resultado remoto incerto. Há busca restrita ao marcador daquela pasta; uma candidata verificável pode concluir o registro. Zero/múltiplas candidatas ou ACL incompleta permanecem bloqueadas. A inspeção pode atualizar **somente o journal local**, jamais recursos ou permissões Drive.

Lock órfão, claim/journal ausente ou corrompido e temporário órfão exigem revisão humana específica. Não foi criado comando para limpar, resetar, apagar ou migrar o laboratório.

## 6. Auditoria de segurança e segredos

A varredura local lê somente arquivos da árvore atual enumerados pelo Git, sem rede e sem imprimir correspondências/valores. Abrange os **61 rastreados**, **sete novos não rastreados** e **3.045 ignorados** do SDK instalado. Entre os rastreados, **55 são textuais e seis binários**. Não havia arquivo não rastreado antes da implementação. Nenhum `.env` ou artefato privado operacional foi criado.

Padrões: chaves Google/API/OAuth conhecidas, blocos de chave privada, tokens GitHub/AWS/JWT, atribuições literais sensíveis e tokens de convidado em query. Fixtures e placeholders explícitos são classificados como sintéticos. Sete ocorrências nos ignorados foram confirmadas como valores ilustrativos em comentários gerados do SDK, sem imprimir seus conteúdos. Nenhum segredo real foi identificado pelos padrões utilizados.

**Limitação obrigatória:** os seis binários não foram examinados quanto a segredos, dados embutidos ou conteúdo visual. Sua integridade por hash não certifica ausência de informação sensível. Padrões textuais também podem ter falsos negativos; a auditoria não é conclusiva nem cobre credenciais externas, histórico Git completo, backups, memória ou instrumentação do sistema. Aceite dessa limitação ou inspeção específica adicional é condição para liberar o primeiro login supervisionado.

Não foram enfraquecidos os testes ou controles de ACL. Os módulos protegidos não mudaram; não se ampliou scope nem se modificou o motor de publicação. IDs pessoais, valores de tokens, códigos e URLs de consentimento não aparecem nas evidências.

## 7. Riscos residuais e pendências

| Risco / limitação | Consequência / condição de avanço |
| --- | --- |
| API real não ensaiada | Confirmar semântica e disponibilidade de root, metadados, ACL, false omitidos, SHA-256 e cancelamento sob `drive.file`. Sem prova, bloquear. |
| Política deliberadamente conservadora | A raiz ou recursos podem não oferecer campos suficientes; não assumir defaults, afrouxar ACL ou ampliar scope para passar. |
| Visibilidade por arquivo | Lista vazia e pasta autorizada não comprovam todos os descendentes. Testar cada fixture prevista com autorização futura. |
| Aprovação e estado locais | Operador/administradores são confiáveis. O registro não é assinatura digital; alteração/rollback externo pode invalidar garantias. |
| Coordenação local | Exclusão vale para o mesmo diretório/filesystem. Não distribuir cópias ou apagar/mover o estado; não há lock distribuído. |
| Persistência / energia | Sync do arquivo, checksum e rename detectam falhas comuns; não são banco transacional ou backup contra perda completa do diretório. |
| Janela remota | Duas observações não são transação Drive e não impedem mudança posterior. Não certificar autoria humana por metadados. |
| Consentimento Testing | Validade curta e renovação/revogação exigem runbook e operador; login não homologa publicação. |
| Binários não inspecionados | Seis ativos preservados sem auditoria de segredos de conteúdo; limitação explícita a aceitar/revisar. |
| Alimentação de fixtures | Upload/Picker/marcação de arquivos futuros não implementados. Exigem escopo de trabalho e autorização próprios. |

## 8. Procedimento futuro e condições de liberação

Procedimento completo em [GOOGLE_DRIVE_LAB.md](GOOGLE_DRIVE_LAB.md), em conjunto com [GOOGLE_DRIVE_OAUTH.md](GOOGLE_DRIVE_OAUTH.md).

Antes do primeiro login: validação final deste diff/inventário/testes; autorização expressa para login da conta exclusiva e uso/armazenamento/renovação de tokens; cliente Desktop/usuário de teste conferidos privadamente; scope único; caminhos/ACLs externos comprovados; ausência de logging sensível; aceite da auditoria limitada de binários e rotina de expiração/revogação/limpeza revisada. Nenhuma dessas aprovações é inferida desta entrega offline.

Depois do login aprovado, a criação exige autorização humana separada para **uma pasta**, registro privado consumível curto e flag de execução. A inspeção/reconciliação exige outra aprovação própria, mesmo cliente/diretório/operação e nenhuma escrita remota. Não repetir create quando houver erro; não limpar estado ou trocar diretório para contornar bloqueio.

Ensaio posterior planejado: no máximo **dois PNGs geométricos, até 64 KiB cada, total até 128 KiB**, checksums esperados, sem imagens pessoais ou convidados. O mecanismo para criar/adicionar/marcar/autorizar esses arquivos depende de novo plano e autorização; **nenhum upload foi realizado**. Um caso manual deve investigar a autorização individual sem presumir herança. Nenhum compartilhamento automático com fotógrafo.

**Pendente de validação do responsável:** aceite do Marco 04B.3B.11. **Não liberado:** primeiro login, criação/inspeção reais, upload, pastas oficiais, uso editorial, publicação e produção.
