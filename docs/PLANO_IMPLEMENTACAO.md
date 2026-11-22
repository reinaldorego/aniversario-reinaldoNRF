# Plano de implementação do LIVE EXPERIENCE — revisão 04A.2

**Escopo deste documento:** consolidar publicação automática pelo Drive e definir o piloto 04B. Sem implementação ou provisionamento nesta etapa.

Base funcional: b1111a5, feature/live-experience. Referência: 07/11/2026. Festa: sábado, 28/11/2026 às 21h UTC−03, Edifício Dhahram, Belém/PA.

[Arquitetura e contratos](ARQUITETURA_LIVE_EXPERIENCE.md) · [Registro de decisões](REGISTRO_DECISOES.md)

## 1. Estado e decisão consolidada

O Marco 03 já oferece mosaico/visualizador responsivo, estados de galeria, fonte de dados separada, atualização manual, demonstração e retorno ao convite. A fonte pública continua Em breve. Não há backend, código de acesso implementado, sincronização, autenticação ou publicação real testados.

**Aprovado na conversa 04A.2:**
- Card e URL existentes, sem uma segunda URL obrigatória.
- Somente organizador/fotógrafo colocam fotos na pasta controlada; colocar ali representa aprovação editorial.
- Após estabilidade, ACL, validação e processamento completos, publicar automaticamente. Não exigir aprovação individual num painel.
- Originais privados Drive; somente derivados autorizados na galeria.
- Código de álbum independente do RSVP, informado na própria página e verificado no servidor.
- Convidados apenas leem; sem upload, edição, exclusão, Drive, telão ou projeção.

**Proposto, não aprovado operacionalmente:** Node.js, provedor, identidade técnica/conta, OAuth, cadências, limites, TTL, metas e infraestrutura. A arquitetura não concede autorização para criar recursos, contratar, acessar Drive ou publicar.

## 2. Portões de aprovação

| Gate | Condição e evidência | Antes de |
| --- | --- | --- |
| G0 — modelo editorial | Decisão 04A.2 registrada; substituir fluxo manual por foto e política de leitura antes pendente. | Concluído documentalmente nesta revisão; não é aceite do backend. |
| G1 — escopo do 04B | Aceite deste plano; escolher prova local primeiro, responsável, formato da evidência e critérios. | Implementar o piloto. |
| G2 — ambiente e custo | Provedor/runtime, região, conta, orçamento/teto, operador, armazenamento e backup aprovados. | Provisionar/contratar qualquer serviço. |
| G3 — Drive e identidades | Autorização específica para pasta de teste isolada, duas identidades comprovadas, tipo de conta, escopos/consentimento e visibilidade ACL demonstrados. | Conectar conta ou acessar arquivos Drive, mesmo de teste. |
| G4 — privacidade e leitura | Código/distribuição, TTL/proxy, retirada, retenção, falha fechada e limite de frescor aceitos. | Expor derivados reais a leitores. |
| G5 — homologação | Segurança, carga, recuperação, custos e regressão aprovados; go/no-go operacional. | Solicitar publicação. |
| G6 — publicação | Aprovações próprias de commit/push/deploy, destino, janela e rollback. | Versionar/publicar quando solicitado. |

A definição de G2/G3 pode ocorrer em paralelo ao desenho local, sem usar recursos reais até autorização. Se uma condição não passar, registrar bloqueio e preservar Em breve. Não adaptar permissões para contornar o gate.

## 3. Piloto 04B incremental e isolado

O piloto não altera backend RSVP, Apps Script, planilha, QR, Access Pass, check-in ou prazo de confirmação. Não usa convidados reais, tokens reais ou fotografias da festa como fixtures. Fixtures técnicas ficam identificadas e separadas do conteúdo público.

### 04B.0 — Núcleo local e replay determinístico

**Entrada:** G1. Sem Drive, credenciais ou serviço externo.

Construir contratos e testes do sincronizador com adaptador substituível: snapshot/feed simulado explicitamente de teste, relógio controlável, fila/outbox, estados, checkpoints, geração, dedupe, tombstones e pausa. Exercitar dados de bytes sintéticos identificados como testes; não simular login para uso real nem criar autenticação fictícia na interface.

**Saída:** testes de replay, corrida, parcialidade e falhas passando; nenhum caminho produz AUTO_PUBLISHED antes dos gates de validação. Escolher um candidato Node.js LTS sem fixar provedor; documentar alternativa se ambiente não couber no prazo.

### 04B.1 — Prova autorizada de conta, identidade e ACL

**Entrada:** G2/G3 explícitos; pasta de teste, sem acervo de convidados e isolada do RSVP.

Comprovar os dois pares OIDC issuer/sub e sua ligação privada aos permissionIds Drive. Validar assinatura/audiência/nonce e vínculo com about usando access token e ID token da mesma troca OAuth/OIDC de servidor, com issuer/sub esperados; provar que ID token e permissionId não são intercambiáveis. Troca de conta durante consentimento deve falhar. Guardar evidências sanitizadas, nunca tokens ou identificadores pessoais neste repositório.

Provar inspeção completa de pasta, arquivos e ancestrais; negar terceiro escritor/owner, herança indevida, grupo/domínio/anyone e leitura externa dos originais. Comprovar que a credencial realmente consegue listar permissões necessárias. Ensaiar OAuth expirado/revogado e isolamento de dados RSVP. Tipo de conta, propriedade e escopos são resultados da prova, não premissas.

**Saída:** matriz das duas contas, identidade técnica se necessária, campos/escopos observáveis e ameaças residuais. Sem visibilidade ACL suficiente, não seguir. Se verificação OAuth/avaliação exigida não couber no calendário, registrar no-go seguro.

### 04B.2 — Detecção, estabilização e reconciliação

**Entrada:** 04B.1 aprovado.

Primeiro candidato: files.list por parent de 02, todas as páginas, ciclo proposto de 60 s, scheduler durável e lease; leitura privada apenas. Capturar checkpoint e inventário completo; reconsultar ausências. Inventário incompleto não retira tudo. Arquivo novo exige duas observações estáveis com intervalo mínimo de 30 s (normalmente dois ciclos), tamanho/checksum e controle de geração.

Comparar com changes.list usando replay e, quando autorizado, feed real do ambiente de teste: bootstrap sem lacuna, checkpoint/outbox atômico, duplicação, perda de acesso e mudança de conta/escopo. Feed não comprova autor. Webhook não é requisito do MVP; se incluído, provar renovação, perda e duplicação, mantendo polling.

**Saída:** medição de unidades Drive, latência, páginas e ACL; seleção justificada da estratégia. Campos desconhecidos ou estado instável permanecem inelegíveis, sem heurística permissiva.

### 04B.3 — Processar, publicar automaticamente e retirar

**Entrada:** 04B.2, armazenamento/fila privados autorizados e pasta certificada. Publicação do ambiente de teste inicialmente pausada.

Validar formato/tamanho/pixels/integridade, gerar derivados sem EXIF/GPS, preservar hash do original. Image worker reporta READY; orquestrador revalida membership, ACL, fingerprint, epochs e pausa antes de commit automático. Não criar botão obrigatório “aprovar foto”.

Testar original alterado no meio do download/job, reentrada, dedupe canônico, retirada no Drive, falha de banco/fila e restauração de tombstones. Testar pausa administrativa durante processamento: novas publicações bloqueadas, retiradas continuam. Retomada exige verificação nova; incidente de ACL exige recertificação/reendosso do conjunto.

**Saída:** uma entrada autorizada gera exatamente uma foto visível após processamento; retirada gera tombstone e bloqueia novas URLs; nenhum replay/duplicata ressuscita conteúdo. Registrar janela residual de mídia.

### 04B.4 — Código, leitura e adaptação mobile

**Entrada:** G4 e backend de teste anterior homologado.

Na própria página LIVE EXPERIENCE, integrar código digitado → sessão viewer em memória → lista/delta/mídia. Código não vai ao build, URL ou logs; nenhum token RSVP chega à API. Manter card e retorno ao convite/#countdown, inclusive contexto token/confirmado.

Integrar adaptador HTTP separado, normalização única de datas, paginação remota, validade de URLs, merge incremental, retirada da imagem aberta, acessibilidade e refresh manual. Fonte demo continua separada. Service Worker só estático; não guardar API/mídia autenticada offline.

**Saída:** 320, 375, 390, 430, 768 e 1280 px, teclado/mobile, acesso ausente/expirado, carregando/vazio/erro/fotos e redução de movimento homologados. Reentrada do código após reload/retorno é testada e aceita.

### 04B.5 — Carga, falhas, custo e decisão de viabilidade

**Entrada:** etapas anteriores com evidências.

Usar cenários sintéticos de 150/300/600 leitores e 500/1.500/3.000 fotos, sem afirmar que correspondem à lista de convidados. Medir cadências e duração total de ACL/inventário, processamento, API, mídia e egress; variar rede celular e rajada de novas fotos. Nenhuma chamada Drive por leitor.

Desligar scheduler/fila/Drive/API, revogar consentimento, simular cota e expirar frescor. Confirmar que Em breve/indisponibilidade é segura e que convites/RSVP continuam independentes. Restaurar backup em ambiente isolado e comprovar que retiradas não voltam.

**Saída:** relatório p50/p95, erro, custo estimado/medido, limites e pendências. Recomendação go/no-go pelo responsável; nenhum deploy automático ao terminar o piloto.

## 4. Continuidade após o piloto

| Marco | Escopo e aceite, após aprovação específica |
| --- | --- |
| 04C — endurecimento da ingestão | Transformar a prova aprovada em conector/worker operacional, rotação, fila durável, quarentena, reconciliação e idempotência. Drive continua interface de colocação editorial, sem upload obrigatório pela API. |
| 04D — controle e leitura | Operacionalizar publicação automática, código/sessões, pausa, status, retries, retirada e auditoria. Não reintroduzir aprovação obrigatória por foto. |
| 04E — integração definitiva | Adaptador, merge/paginação, estados de acesso e renovação; preservar galeria visual, demo, SW e retorno já existentes. Reutilizar o que o piloto comprovar. |
| 05 — homologação | Segurança, mobile/celular, concorrência, restauração, janela de retirada e treinamento dos dois publicadores. |
| 06 — publicação controlada | Somente com autorização própria; registrar versão, backup, rollback e plantão. |

Módulos comprovados no 04B não devem ser reimplementados apenas para cumprir nomes de marcos. O escopo final de cada etapa depende do aceite do piloto.

### Calendário de referência, não compromisso de entrega

- 07–10/11: decisão de viabilidade, contratos/prova local, orçamento e conta.
- 11–15/11: conexão autorizada, identidades/ACL e sincronização isolada.
- 16–20/11: pipeline, retirada, pausa, código e integração de teste.
- 21–24/11: carga, falhas, recuperação e custos.
- 25–26/11: homologação e congelamento de escopo.
- 27/11: go/no-go, plantão e contingência.
- 28/11 às 21h: operação somente se aprovada e homologada.

Verificação OAuth, conta indisponível ou custos sem aceite podem inviabilizar essa janela. Não reduzir segurança para cumprir data. Se necessário, preservar Em breve e separar a publicação posterior do álbum; não anunciar integração real pronta sem evidência.

## 5. Matriz de testes de segurança e sincronização propostos

Estes testes ainda não foram executados: são critérios para implementação futura.

| ID | Cenário | Resultado obrigatório |
| --- | --- | --- |
| S01 | Terceira conta Google acessa administração | Negado em cada rota, não só no login. |
| S02 | OIDC com issuer/aud/nonce inválido ou conta trocada na vinculação Drive | Rejeitar sessão/vínculo, sem usar e-mail do cliente como prova. |
| S03 | permissionId diferente de sub ou consulta about do sincronizador | Não inferir vínculo humano; exigir prova sob a conta correta. |
| S04 | Escritora humana terceira, owner terceiro ou permissão herdada | Bloquear publicação e certificar incidente. |
| S05 | Anyone, link público, domínio, grupo ou leitor externo de originais | Negar enquanto não houver política/ACL segura; no MVP, grupos não permitidos. |
| S06 | ACL não totalmente visível, página falha ou ancestral desconhecido | Fail-closed, não presumir que só existem duas pessoas. |
| S07 | Arquivo tem ACL direta insegura, pasta parece segura | Rejeitar aquele arquivo e aplicar tratamento de incidente. |
| S08 | Feed/notificação sem autor, último modificador diferente do remetente | Não atribuir autoria; reconsultar estado e evidência da pasta. |
| S09 | Pasta já contém fotos antes da certificação ou após ACL comprometida | Não liberar backlog; reendosso de conjunto ou reentrada após certificação. |
| S10 | Arquivo zero bytes, parcial ou cresce entre observações | Não publicar; aguardar estabilidade. |
| S11 | MIME falso, imagem truncada, gigante, animada ou bomba | Rejeitar/quarentenar dentro de limites; original intacto. |
| S12 | GPS/EXIF no original | Derivados sem metadados pessoais; original privado com hash preservado. |
| S13 | Subpasta/atalho/URL externa/folderId do cliente | Não seguir nem ampliar escopo de leitura. |
| S14 | Mesmos bytes em IDs diferentes ou mesmo nome com bytes diferentes | Um canônico por hash; nomes não decidem dedupe. |
| S15 | Remover canônico com duplicata ainda em 02 | Retirar foto sem promover duplicata silenciosamente. |
| S16 | Mudar bytes/parent/ACL durante download ou antes de commit | Job antigo não publica; revalidação/epoch prevalece. |
| S17 | Repetir job, feed ou página fora de ordem | Idempotência; sem foto duplicada ou perda de tombstone. |
| S18 | Erro na última página/incompleteSearch/token de files.list rejeitado | Não confirmar inventário vazio/completo; recomeçar sem retirada em massa. |
| S19 | Crash entre página e checkpoint/fila | Outbox durável; replay seguro sem pular mudanças. |
| S20 | Change.removed representa perda de acesso, não exclusão | Suspender geração conhecida e investigar; não afirmar que original foi apagado. |
| S21 | Remover/reinserir durante job e repetir callback antigo | membershipEpoch e geração impedem publicação obsoleta. |
| S22 | Pausar durante job READY/commit concorrente | CAS do controle bloqueia novas publicações; retiradas seguem. |
| S23 | Retomar backlog após pausa/incidente | Revalidar origem/ACL; incidente requer recertificação, sem liberação cega. |
| S24 | Webhook perdido/duplicado/forjado/canal vencido, se adotado | Nenhuma publicação a partir do sinal; polling/reconciliação corrigem. |
| S25 | OAuth revogado/Testing expira/cota/rede falha | Pausar com alerta/backoff; não ampliar escopo nem expor Drive. |
| S26 | Frescor/lease de presença ou ACL vencido | Bloquear nova emissão; não servir indefinidamente com origem desconhecida. |
| S27 | Código inválido, brute force, várias sessões no mesmo NAT | Limites proporcionais e resposta uniforme; convidados legítimos não bloqueados globalmente. |
| S28 | Token/confirmado RSVP enviado em vez do código | Não concede acesso; nenhuma consulta a convidados/planilha. |
| S29 | Sessão viewer tenta upload, pausa, retry, edição/exclusão | Sem autorização; inexistência de endpoints de upload não vira bypass. |
| S30 | CSRF, IDOR, mass assignment ou job/callback falsificado | Negar ação/objeto e registrar falha sanitizada. |
| S31 | Rotação de código, revogação de sessão, leitura de retirada | Nenhuma nova URL após bloqueio; medir validade residual já emitida. |
| S32 | Cache/SW/offline/analytics/logs | Sem código, token, originais ou mídia privada persistidos/vazados. |
| S33 | Backup/rollback/replay antigo | Tombstones/política atual prevalecem; não ressuscitar retiradas. |
| S34 | Compartilhar credencial entre galeria e RSVP | Prova de isolamento deve reprovar configuração; sem afetar credenciamento. |

Testar também limitação de recursos do worker, dependências atualizadas, acesso a outros eventos e expiração de URLs durante visualização. Referências técnicas e ameaças estão na arquitetura; testes negativos são obrigatórios, não somente o caminho feliz.

## 6. Critérios de aceite funcionais e operacionais

| Critério | Evidência exigida |
| --- | --- |
| CA01 — publicação editorial | Foto colocada pelos dois únicos escritores na pasta certificada publica automaticamente só após validação/derivados completos; sem etapa humana por foto. |
| CA02 — identidades e ACL | Vínculos OIDC/Drive comprovados; acesso direto/herdado/owner/arquivo inspecionado; terceiro/indeterminado bloqueia. |
| CA03 — integridade | Tamanho/tipo/pixels/checksums/estabilidade validados; original inalterado; derivados sem GPS/EXIF. |
| CA04 — idempotência | Replay, retry, duplicata e corrida não duplicam publicação nem anulam retirada. |
| CA05 — pausa | Somente dois administradores; flag durável impede novas publicações inclusive em voo, sem parar retiradas. |
| CA06 — retirada | Saída da pasta detectada/revalidada, tombstone/índice corretos, UI e emissão bloqueadas; janelas medidas e aceitas. |
| CA07 — leitura | Mesmo card/URL, código independente no servidor, sem segredo embutido, sem privilégio de escrita/Drive ao convidado. |
| CA08 — lifecycle | Antes da primeira foto Em breve; depois de abrir e retirar todas, vazio; pós-evento só encerra por política aprovada. |
| CA09 — mobile | 320/375/390/430/768/1280 px sem overflow; teclado, foco/diálogo, redução de movimento, loading/erro/expiração. |
| CA10 — progressão | Paginação/merge/delta, URLs renovadas e manual sem duplicar fotos ou fechar arbitrariamente o visualizador. |
| CA11 — regressão | Convite, card, RSVP tokenizado, Access Pass/QR/check-in e retorno/#countdown preservados, sem confirmações reais em testes. |
| CA12 — cache | SW estático consistente, API e mídia autenticada fora de caches persistentes; demo sem mistura com real. |
| CA13 — operação | Métricas/alertas, consentimento válido, custo autorizado, backup independente e restauração ensaiada. |
| CA14 — contingência | Perda de sincronização/ACL bloqueia segurança; não torna pasta pública; convite continua independente. |

Metas propostas para o piloto, não SLA: p95 de inclusão até aparição no celular ≤4 min em operação saudável; medir separadamente detecção/estabilização/processamento/UI. Retirada: p95 de detecção/commit ≤120 s, UI ≤45 s após commit; mídia previamente emitida no máximo até seu TTL/lease, proposto ≤5 min. Qualquer aprovação de janela final depende de carga, ACL e rede medidas; atrasos durante falha são apresentados, não escondidos. Se a política exigir revogação por requisição, revisar para proxy antes do aceite.

Frescor H proposto de cinco minutos deve ser maior que a duração validada do ciclo de ACL e menor que a janela aceita de risco. Configuração incapaz de cumprir ambos reprova o MVP, sem aumentar H silenciosamente.

## 7. Capacidade, custos e escolhas antes da infraestrutura

Usar cenários e fórmula da arquitetura: Drive por sincronização, nunca por convidado; contabilizar ACL paginada, metadados, downloads, egress e retries. Registrar peso dos métodos/quota do projeto real e se é legado. Estimar runtime, scheduler, fila, banco, storage, backup, logs/cofre, Drive e eventual verificação/avaliação OAuth.

Decisões ainda necessárias:
1. Aceitar candidato Node.js ou alternativa; escolher provedor/região e operador.
2. Aprovar conta/faturamento/teto/alertas, eventual plano pago e efeito de suspensão.
3. Definir tipo de Drive, propriedade e acesso restrito da credencial, sem alcance ao RSVP.
4. Comprovar as duas identidades e todo ACL relevante; resolver requisitos OAuth e duração do consentimento.
5. Confirmar volume/formatos/exportação e banda do fotógrafo.
6. Definir código aleatório, distribuição privada, rotação, expiração e suporte; aceitar risco de repasse e reentrada após reload.
7. Aprovar mídia assinada versus proxy, frescor e janela de retirada.
8. Definir retenção pós-evento, backup independente, RPO/RTO e plano de plantão.
9. Aprovar estratégia/cadência com evidência de latência/custo, sem promessa instantânea.

Nenhum valor monetário foi homologado. Ausência de orçamento/provedor/consentimento viável é impedimento para provisionar, não autorização para depender de conta RSVP ou pasta pública.

## 8. Runbook e contingência para a festa

Antes de ativar: pasta certificada, identidades/código e permissões revisados, formatos instruídos, backup independente testado, retirada/pausa ensaiadas e métricas sem segredos. Armazenar parâmetros e credenciais em mecanismos privados autorizados; não no Git.

Operação dos publicadores: manter originais locais; colocar autorizadas em 02_PUBLICAR_NA_GALERIA; observar status/última sincronização. Aguardar processamento medido, sem clicar “aprovar foto”. Para retirar, mover para fora de 02 (03 opcional); conferir tombstone e janela residual. Para incidente, suspender novas publicações e revisar ACL antes de retomar.

Falha: registrar hora/causa, pausar, preservar jobs/outbox e originais, exibir indisponibilidade/frescor verdadeiro. Leitura só enquanto autorizada e dentro do lease. Não abrir acesso ao Drive, desativar código ou alterar RSVP como contingência.

Recuperação: reconciliar fonte/índice/derivados, reaplicar tombstones e epochs, renovar consentimento quando necessário; recertificar se houve incidente e testar leitura antes de reabrir. Álbum pós-evento segue retenção aprovada; nenhuma exclusão automática por data da festa.

## 9. Evidências e revisão documental 04A.2

Cada etapa futura deve apresentar arquivos/contratos alterados, comandos/testes e resultados, métricas sanitizadas, custos, riscos residuais, pendências e decisão de avanço. Não anexar fotos privadas, códigos, tokens, PINs, e-mails ou permissionIds reais.

Nesta revisão somente os três documentos autorizados são atualizados; Documento Mestre e arquivos funcionais preservados. Validações locais documentais: diff/check de whitespace, estrutura/links internos/exemplo JSON, estado Git e comparação de integridade dos demais arquivos. Isso não equivale a teste de Drive, autenticação, processamento, carga, publicação ou restauração.

Não executar commit, push, merge ou deploy. Aguardar aprovação antes de implementar o 04B ou acessar qualquer recurso real.
