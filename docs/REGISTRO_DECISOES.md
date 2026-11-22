# Registro de decisões — LIVE EXPERIENCE — revisão 04A.2

**Decisão de negócio aprovada nesta conversa; implementação e infraestrutura não autorizadas por este registro.**

Referência: 07/11/2026. Base funcional b1111a5, feature/live-experience. Evento: 28/11/2026, sábado, 21h UTC−03, Edifício Dhahram, Belém/PA.

[Arquitetura](ARQUITETURA_LIVE_EXPERIENCE.md) · [Plano incremental e testes](PLANO_IMPLEMENTACAO.md)

## 1. Status e origem das decisões

- **Herdada:** requisito do Documento Mestre/preservação já solicitada.
- **Observada:** comportamento lido no frontend b1111a5, não backend homologado.
- **Aprovada 04A.2:** decisão expressa do responsável nesta conversa, no escopo descrito.
- **Proposta:** recomendação técnica a testar e aprovar.
- **Pendente:** informação/escolha necessária antes da etapa correspondente.
- **Superada:** proposta anterior substituída; não deve orientar implementação.
- **Descartada:** atalho incompatível com o escopo.

A proposta 04A exigia aprovação humana por foto e deixava em aberto a leitura dos convidados. O responsável decidiu agora que a presença na pasta controlada é aprovação editorial para publicação automática e que a leitura será por código independente do álbum. Essas duas definições substituem a proposta anterior. Não houve aprovação definitiva de Node.js, provedor, compra, credenciais, Drive ou deploy.

O Documento Mestre não foi alterado. A aprovação editorial por pasta mantém a restrição de que somente organizador/fotógrafo podem publicar; a automação aplica essa decisão, não cria um terceiro publicador humano.

## 2. Registro consolidado

| ID | Tema | Status | Decisão / consequência vigente |
| --- | --- | --- | --- |
| ADR-01 | Preservação | Herdada | URLs/Black & Gold, convite, token, RSVP, Access Pass, QR e check-in intactos. |
| ADR-02 | Backend/provedor | Proposta | API independente, Node.js candidato; Python alternativa; provedor e orçamento não aprovados. Comparação A/B/C mantida na arquitetura. |
| ADR-03 | Dois publicadores | Herdada + método proposto | Somente duas identidades humanas; login OIDC, allowlist privada e vínculo comprovado aos permissionIds Drive. |
| ADR-04 | Leitura | Aprovada 04A.2 | Código do álbum independente do RSVP, não embutido no frontend, digitado na página existente. Parâmetros/distribuição/rotação pendentes. |
| ADR-05 | Originais | Herdada + Aprovada 04A.2 | Drive privado; somente derivados autorizados na galeria; não tornar pasta pública. Conexão/tipo de conta pendentes. |
| ADR-06 | Mídia/cache | Proposta | Derivados privados, URLs curtas; TTL/proxy/janela residual a aceitar. Sem recall de bytes já baixados. |
| ADR-07 | Aprovação editorial automática | Aprovada 04A.2; proposta manual 04A superada | Colocar fotografia autorizada em pasta certificada representa aprovação. Processar/validar e publicar automaticamente; sem painel obrigatório por foto. |
| ADR-08 | Segredos/isolamento | Herdada | Sem segredos em Git/frontend; backend e credenciais separados de RSVP/planilha/check-in. |
| ADR-09 | Atualização de convidados | Proposta | Paginação/delta/merge, poll de 30 s com jitter/backoff e refresh manual; não implementados hoje. |
| ADR-10 | Capacidade/custo | Pendente | Carga sintética, conta, região, orçamento, operação e limites antes de infraestrutura. |
| ADR-11 | Backup/retenção | Pendente, com requisito aprovado | Backup independente; pasta no mesmo Drive não o substitui. Destino, custo, RPO/RTO e retenção ainda a decidir. |
| ADR-12 | Demonstração | Herdada/observada | Separada do conteúdo público real, identificada e sem credenciais/fotos privadas. |
| ADR-13 | Aceite/versionamento/publicação | Herdada | Aprovação por etapa; nenhum commit, push, merge ou deploy nesta revisão. |
| ADR-14 | Organização de pastas | Proposta consolidada | 01_ORIGINAIS fora do editorial; 02_PUBLICAR_NA_GALERIA autoriza; 03_RETIRADAS opcional. Movimentação humana, serviço de leitura. |
| ADR-15 | Detecção Drive | Proposta | MVP files.list por parent a cada 60 s, completo e reconciliado; changes.list é alternativa/evolução. Cadência final depende de medição. |
| ADR-16 | Autoria e autorização | Aprovada 04A.2 | Feed/notificação não prova autor. Autorização explícita é presença em pasta com ACL certificada; não inventar ator humano na auditoria. |
| ADR-17 | ACL direta/herdada | Aprovada 04A.2; mecanismo proposto | Negar exposição e terceiros não autorizados; inspecionar pasta/ancestrais/arquivo com visibilidade comprovada. |
| ADR-18 | Pausa administrativa | Aprovada como requisito 04A.2 | Botão para os dois administradores suspende novas publicações; retiradas/reconciliação continuam. Flag durável/epochs propostos. |
| ADR-19 | Estabilidade/processamento | Aprovada como requisito; limites propostos | Validar completude/integridade/duplicidade; derivados sem EXIF/GPS antes de publicação, original intacto. |
| ADR-20 | Retirada/recuperação | Aprovada como requisito; mecanismo proposto | Saída de 02 despublica após detecção; tombstone/idempotência/reconciliação impedem ressurreição. Janelas pendentes de aceite. |
| ADR-21 | Certificação e histórico | Proposta | Pasta vazia certificada ou reendosso inicial do conjunto; nova certificação após incidente. ACL atual não prova histórico. |
| ADR-22 | Falhas e frescor | Proposta | Pausa/bloqueio quando origem/ACL não verificáveis; leases limitam continuidade, sem exposição pública como contingência. |
| ADR-23 | MVP para a festa | Proposta condicional | 04B local → ambiente autorizado → pipeline/retirada → código/mobile → carga/falhas. Se não passar, Em breve preservado. |

## 3. ADR-02 — Comparação de backend preservada

**A — Apps Script separado:** reduz configuração inicial para metadados, mas cotas por identidade e limites de processamento/HTTP podem afetar disponibilidade. Separar projeto sem isolar identidade pode manter cotas compartilhadas com RSVP. Precisa de prova de identidade e entrega de derivados, não um Web App por original/convidado.

**B — API independente Node.js/Python:** maior controle de autenticação, jobs, imagens, índice e mídia; mais responsabilidade por runtime, fila, segredos, IAM, custos e operação. Node.js é candidato pela continuidade com JavaScript, sem alegação de superioridade medida.

**C — Supabase ou equivalente:** Auth/Postgres/Storage ajudam a operação, mas não eliminam conector Drive/worker. Verificar limites, pausa, egress, RLS e preço de transformações; chave privilegiada não vai ao browser.

Recomendação técnica continua B, condicionada à prova segura e à capacidade de operar. Cloud Run/Firestore/Storage são referência de orçamento, não escolha aprovada. A/C continuam comparáveis se o piloto indicar melhor viabilidade. Fontes, limites, custos e indisponibilidade constam na seção 3 da arquitetura.

## 4. ADR-03/16/17 — Identidade, ACL e o que o feed não prova

OIDC verificado responde quem administra. ACL responde quem pode inserir no Drive. Presença na pasta segura responde qual arquivo recebeu autorização editorial. Código do álbum responde se a sessão pode ler derivados. São controles distintos; nenhum usa a planilha RSVP.

Vincular privadamente cada issuer/sub ao permissionId da mesma conta por consentimento/verificação de identidade no servidor. O ID token e o permissionId têm funções diferentes; nome, e-mail do cliente ou última modificação não são prova suficiente. Consultar about sob a conta técnica não identifica o fotógrafo. [Google OIDC](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [About](https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get)

A assinatura/entrega de uma notificação do Drive não identifica o humano que colocou a imagem. changes.list indica alterações no contexto da conexão, não aprovação humana individual. Auditoria deve registrar automação, presença editorial e evidência de ACL; ator humano desconhecido permanece desconhecido.

Negar writers/owners humanos fora dos dois, anyone/domínio/grupo e outros leitores externos dos originais. Inspecionar herança/ancestrais e permissões diretas dos arquivos; My Drive e Shared Drives têm detalhes diferentes. Falha ou visibilidade parcial bloqueia, em vez de assumir ausência de terceiros. Provar isso em 04B antes de usar fotos reais. [Permissões](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions), [Compartilhamento](https://developers.google.com/workspace/drive/api/guides/manage-sharing)

Administradores de infraestrutura e da organização são parte explícita da fronteira de confiança; não prometer que uma ACL Drive elimina seus poderes. O risco de conta autorizada comprometida exige MFA, revogação e resposta operacional.

## 5. ADR-05/07/14/19 — Fluxo editorial aprovado

Fluxo: **pasta privada controlada → observação e ACL → estabilização → validação → derivados → revalidação → commit automático → galeria por código.**

01_ORIGINAIS é acervo fora do editorial. Arquivos em 02_PUBLICAR_NA_GALERIA continuam sendo originais privados; mover para lá ou enviar diretamente autoriza após os controles. Não exigir cópia permanente nas duas pastas. Mover para fora retira; 03_RETIRADAS é organização opcional, não mecanismo obrigatório. Sem movimentação automática de originais pelo backend no MVP.

MVP considera apenas imagens diretas, sem atalhos/subpastas. Estabilidade proposta: duas observações consistentes separadas por pelo menos 30 s, download e integridade verificados, nova consulta antes do commit. Limites de 20 MiB/40 MP e formatos JPEG/PNG/WebP estáticos serão ensaiados, não homologados neste registro.

Image worker gera READY; orquestrador publica automaticamente se membership, versão/bytes, ACL, securityEpoch e pausa ainda forem válidos. Sem revisão humana por foto. Dedupe por bytes/evento com canônico evita cards repetidos e promoção silenciosa de cópia depois de retirada.

**Proposta antiga superada:** exigir upload pelo aplicativo seguido de clique humano publish. **Não superado:** original privado, validação, segurança, idempotência e responsabilidade editorial dos dois publicadores.

`drive.file` não basta presumidamente para filhos enviados pela interface nativa Drive. Avaliar consentimento de leitura em conta/contexto dedicado ou leitor técnico com acesso comprovado e limitado; não ampliar o acesso da conta RSVP. Escopos restritos podem exigir verificação/avaliação; pendência de calendário e custo, sem isenção presumida. [Escopos](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

## 6. ADR-15/20/21/22 — Detecção, retirada e recuperação

### Alternativas consideradas

- **MVP candidato:** varredura completa por parent a cada 60 s, todas as páginas, inventário válido, rechecagem individual das ausências, ACL periódica e jobs/outbox duráveis.
- **Evolução:** changes.list com bootstrap/cursor durável e reconciliação periódica. Capturar início antes do inventário; não pular página antes de registrar seus efeitos.
- **Otimização opcional:** changes.watch acorda o consumidor; sem dados/autor do arquivo, requer renovação e não substitui polling. Não depender apenas de watch da pasta.

[Feed e detecção](https://developers.google.com/workspace/drive/api/guides/manage-changes), [Listagem de arquivos](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Push](https://developers.google.com/workspace/drive/api/guides/push)

Propostas de cadência não são garantia de latência. Custo deve contar ACL e metadados/download, não só uma listagem. changes.list pode conter ruído de toda a conta; não afirmar que sempre reduz cotas.

Retirada tem janelas distintas: ação no Drive até detecção, commit no índice até UI, e validade residual de mídia já emitida. O alvo de UI de 45 s é posterior ao commit, não desde a movimentação Drive. TTL máximo de mídia/frescor proposto de cinco minutos requer aceite; proxy pode ser necessário se a política exigir checagem por requisição. Bytes baixados não são recolhíveis.

Pausa de novas publicações é comando durável e auditado para as duas identidades. Incidente de ACL é bloqueio de segurança: recertificar/reendossar o conjunto antes de retomar. Antes da certificação inicial, backlog existente não é presumidamente autorizado.

Listagem parcial não é pasta vazia. 403 não é confirmação de exclusão. Feed repetido/job antigo/backup não deve reabrir retirada. Checkpoints, epochs, idempotência e tombstones prevalecem na recuperação. Não existe commit atômico entre ACL Google e banco; documentar a janela residual e reduzir com revalidação/leases.

## 7. ADR-04/06/09 — Código e continuidade da experiência

A página existente apresenta Em breve antes da primeira publicação. Com fotos e sem sessão, pede código nela própria; sem nova URL obrigatória. Código não é token RSVP, não está no card/build e não é levado em fragmento/query.

Código aleatório compartilhado, hash/KDF no servidor, tentativas limitadas e distribuição privada são propostas de mecanismo; sua extensão, expiração e política de rotação ainda dependem de decisão. Sessão viewer opaca de 1 h em memória e TTL de mídia de até cinco minutos são hipóteses. Código pode ser repassado; não identifica convidado individualmente. Reload/retorno pode exigir redigitação, a homologar.

Adaptador receberá dados HTTP/datas ISO e renovará mídia. Normalizador atual descarta mediaExpiresAt; atual refresh fecha o diálogo. Portanto integração exige preservar validade e fazer merge/paginação, não simplesmente trocar uma URL. Poll de 30 s com jitter é proposta, mantendo manual e pausa/backoff em abas ocultas/falhas.

Depois de aberto, retirar todas leva ao estado vazio. Pós-evento segue retenção aprovada, sem encerramento automático pela data da festa. Fonte demo e SW estático continuam separados de dados reais. Navegação preserva contexto RSVP apenas para retorno ao convite/#countdown, nunca para autorizar leitura.

## 8. Atalhos descartados

| Atalho | Motivo |
| --- | --- |
| Tornar Drive/bucket público ou abrir link como contingência | Expõe originais/derivados sem política aprovada. |
| Publicar arquivo de qualquer pasta ou com ACL incerta | Não há autorização editorial controlada. |
| Atribuir humano usando change feed/notificação/lastModifyingUser | Não prova quem colocou a foto na pasta. |
| Checar só writers diretos da pasta | Ignora herança, owner e permissões próprias dos arquivos. |
| Presumir drive.file cobre uploads nativos | Acesso não é concedido a todos os filhos automaticamente. |
| Ampliar OAuth da conta RSVP para economizar configuração | Rompe isolamento e aumenta exposição. |
| Fazer ACL atual provar todo o histórico | Não detecta inclusão ocorrida durante acesso indevido anterior. |
| Exigir painel por foto como único caminho | Contradiz a decisão editorial automática 04A.2. |
| Esconder botões para proteger administração | API precisa verificar identidade e papel por ação. |
| Usar código curto previsível, hardcoded ou token RSVP | Facilita acesso indevido e mistura finalidades. |
| Salvar OAuth/bearer/código em frontend, Git, logs ou URLs | Vazamento de credenciais e expansão de acesso. |
| Avançar cursor antes da fila ou retirar tudo por página incompleta | Perda de eventos e retirada indevida em massa. |
| Continuar servindo indefinidamente com sincronização quebrada | Não verifica retirada ou mudança de permissões. |
| Promover duplicata/backup ignorando tombstone | Ressuscita conteúdo retirado. |
| Backup só no mesmo Drive | Mesmo domínio de falha; não substitui cópia independente. |
| Garantir instantâneo, gratuidade ou capacidade por Free Tier | Sem medição/contratação não há garantia. |
| Telão, projeção, upload de convidados ou reconhecimento facial | Fora do escopo. |

## 9. Decisões e informações ainda pendentes

| ID | Escolha / prova | Impacto / etapa bloqueada |
| --- | --- | --- |
| D01 | Node.js ou alternativa, provedor, região e operador | Provisionamento e suporte; Node não está definitivamente aprovado. |
| D02 | Conta de faturamento, teto, alertas e custo total | Nenhuma contratação/recurso pago sem autorização. |
| D03 | Código: geração/extensão, distribuição, expiração/rotação e suporte | Segurança/UX da leitura na mesma página; política por código já aprovada, não reabrir essa escolha. |
| D04 | URLs assinadas versus proxy, TTL, frescor e janela residual | Privacidade, revogação, cache e custo de mídia. |
| D05 | Tipo de conta Drive, propriedade/armazenamento, escopos/OAuth e avaliação | Acesso nativo, isolamento, ACL e viabilidade antes de 28/11. |
| D06 | Duas identidades reais e vínculo privado OIDC/permissionId | Administração e certificação da pasta; não registrar dados pessoais aqui. |
| D07 | Formatos/exportação, volume, ritmo e banda do fotógrafo | Pipeline, estabilidade e throughput. O fluxo editorial por pasta já está aprovado. |
| D08 | Varredura/feed, cadências e SLO após piloto | Latência, quotas e tratamento de falhas medidos. |
| D09 | Backup independente, retenção pós-evento, RPO/RTO e operador | Continuidade/recuperação e permanência do álbum. |
| D10 | Ambiente autorizado de teste, calendário e go/no-go | Implementação do 04B e eventual publicação posterior. |

Os parâmetros propostos não são decisões já tomadas. As duas pessoas ainda não foram identificadas/configuradas no sistema, e não houve inspeção de permissões/conta real. Até os gates, a fonte pública funcional segue Em breve.

## 10. Critérios para registrar próximos aceites

Registrar responsável, data, decisão exata, condições, evidências sanitizadas, custo, risco residual, alternativa e reversão. Usar IDs de ADR/pendência para não confundir aprovação de negócio com autorização de infraestrutura.

**Resultado 04A.2:** decisão editorial automática e código do álbum consolidados nos três documentos; métodos de detecção, permissões, processamento, retirada, pausa, recuperação e piloto definidos como propostas técnicas. Nenhum backend, autenticação, pasta, credencial ou serviço foi implementado/criado/testado aqui. Aguardar aprovação antes de implementar.
