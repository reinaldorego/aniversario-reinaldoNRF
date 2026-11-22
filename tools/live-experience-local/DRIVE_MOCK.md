# Adaptador Drive API v3 simulado — Marco 04B.2

Implementação exclusivamente offline, com cliente em memória. Nenhuma requisição à internet, Google Drive, OAuth, SDK ou identidade real. Não integra o frontend público e não muda o backend de credenciamento. A nomenclatura deste marco segue o pedido atual; não autoriza a conexão real prevista no plano 04A.2.

## Contrato anterior e extensão

Antes desta etapa, Simulator.open criava LocalSource diretamente. O contrato usado pelo motor era:

| Operação | 04B.1 |
| --- | --- |
| init() | Preparar diretórios locais. |
| list(mode) | Promise de {complete, entries}; cada entry contém name, hash SHA-256, fingerprint, size e data. |
| read(name) | Reobservar bytes e fingerprint; ENOENT significa ausência confirmada. |
| Motor | Duas observações estáveis, jobs/estados, dedupe SHA-256, pausa, revisões, tombstones e JSON persistido. |

A implementação mantém LocalSource como padrão e todos os testes anteriores intactos. A extensão é aditiva:

| Operação / atributo | Novo contrato interno |
| --- | --- |
| Simulator.open({source}) | Fonte injetada; ausência mantém operação local anterior. |
| source.identity | Identificador de configuração; persistido privadamente para impedir troca silenciosa de origem/allowlist. |
| init(checkpoint) | Restaura referências privadas do último inventário aceito, sem liberar leitura antes de nova reconciliação. |
| authorize() | {status: allowed/denied/indeterminate, code}; avaliação simulada da pasta/ancestrais. |
| list(mode, checkpoint) | {complete:true, entries, checkpoint}; falhas lançam erro sanitizado e não produzem snapshot vazio completo. |
| read(name) | Conteúdo verificado entre duas provas de metadados/ACL, com SHA-256 real. |
| revalidate(name, fingerprint) | Revalidação de membership, metadados e ACL imediatamente antes da transição de publicação. |
| readAllowed | false bloqueia leitura pública, sem alterar todos os estados para WITHDRAWN. |
| authorization | Último resultado sanitizado; alimenta pausa/epoch em caso de falha. |

`entry.name` é uma chave opaca derivada do ID, com extensão .png para compatibilidade do processador de teste. Não é nome original nem ID público. `entry.hash` é SHA-256 dos bytes; `entry.fingerprint` é digest da tupla normalizada de metadados. O ID público continua sendo o UUID gerado pelo motor.

Os únicos ajustes funcionais existentes ficam em src/engine.mjs: injeção, separação do diretório de derivados da fonte, vínculo de origem, hooks de autorização/revalidação e checkpoint no snapshot persistido. Codec, armazenamento, HTTP, CLI, fonte local e suíte 04B.1 permanecem byte a byte inalterados.

## Cliente injetável, sem transporte

DriveSource aceita cliente marcado `mode: "synthetic-drive-v3"`, com:

```js
client.files.list(params, { signal })
client.files.get(params, { signal, responseType })
client.permissions.list(params, { signal })
// Resposta: { data: ... }; erro simulado: { response: { status } }
```

O MockDriveClient está em test/drive-fixtures.mjs. Ele guarda metadados, bytes sintéticos, ACLs, paginação e filas de falhas em memória. Não possui cliente HTTP, SDK, login ou credencial. O marcador de modo previne ligação acidental a um SDK real; não é uma fronteira de segurança contra código injetado malicioso.

`client.aclVisibility = "complete"` é uma **atestação do cenário de teste**, não um campo fornecido pela Drive API nem comprovação de visibilidade real. Sem ela, a autorização fica indeterminada. Não inferir que HTTP 200 ou uma lista curta de permissões prova visibilidade completa de uma conta real.

## Campos efetivamente utilizados

| Resposta | Campos / finalidade |
| --- | --- |
| files.list | files, nextPageToken, incompleteSearch; inventário paginado. |
| File | id, parents e trashed: identidade e elegibilidade; name e mimeType: perfil PNG sintético permitido. |
| File binário | version, size, md5Checksum, modifiedTime: versão/fingerprint e integridade. size é string decimal na resposta e número limitado internamente; version permanece string. |
| File de pasta | id, parents, mimeType e trashed: cadeia de ancestrais, sem seguir nomes. |
| files.get alt=media | Buffer/Uint8Array no mock, limitado antes da cópia; tamanho/MD5 e SHA-256 calculados. |
| permissions.list | permissions, nextPageToken; todas as páginas. |
| Permission | id, type, role, deleted e permissionDetails(inherited, inheritedFrom, role, permissionType). |

Campos extras, owners, e-mail, description, displayName e lastModifyingUser são descartados. Não há download por URL do cliente, thumbnailLink, escrita Drive ou uso de changes.list nesta implementação.

O perfil exige campos explícitos, inclusive incompleteSearch=false. Campo ausente não vira false por suposição. Confirmar posteriormente como a conta/cliente real representa defaults, raízes, ACLs e respostas parciais antes de adaptar o contrato.

## Descoberta, processamento e checkpoint

1. Verificar pasta editorial e ancestrais, com ACLs completas no cenário.
2. Executar files.list com query exata `'<folderId>' in parents and trashed = false`. Não aceitar pasta informada pela API pública. IDs de configuração são validados para não interpolar query arbitrária.
3. Percorrer todas as páginas. Token repetido, vazio/inválido, limite excedido, dados incompletos ou incompleteSearch impedem aceitação.
4. Normalizar só arquivos diretos na pasta correta e não trashed; descartar entradas inelegíveis. Duplicação de ID na resposta é ambígua e bloqueia o inventário.
5. Obter conteúdo separadamente, com ACL da pasta/ancestrais/arquivo e metadados antes/depois. Exigir tamanho/MD5 consistentes, calcular SHA-256 e validar o perfil de imagem no processador já existente.
6. Fazer segundo inventário completo e comparar as tuplas normalizadas. Revalidar certificado da pasta. Divergência impede aceitar o ciclo.
7. O motor confirma individualmente referências antigas ausentes. Só depois reconcilia retiradas, entradas e jobs e salva o checkpoint junto ao estado no mesmo snapshot JSON.
8. Antes de PUBLISHED, repetir verificação do conteúdo/metadados e a autorização final. READY, falha, job obsoleto ou pausa não aparecem como foto publicada.

Não há checkpoint parcial por página. Persistem apenas estratégia, identidade, sequência, digest e inventário completo aceito. Falha na segunda página mantém o checkpoint anterior; a próxima varredura começa na primeira página, inclusive após reinício. Não se trata de cursor changes.list.

A consistência é observacional: dois inventários iguais e consultas individuais reduzem risco, mas não fornecem snapshot transacional do Drive. Uma mudança muito rápida ou ocorrida após a última consulta ainda pode escapar. Não há garantia de autoria, publicação instantânea ou atomicidade entre Drive e índice.

Estabilização continua no motor: pelo menos duas observações, intervalo configurado e fingerprint estável com versão/tamanho/checksum/parents/modifiedTime. modifiedTime isolado não basta. SHA-256 deduplica bytes; checksum não prova autorização. A versão alterada com bytes iguais não exige novo processamento de foto já publicada; conteúdo novo exige outra geração e nova estabilidade.

## Autorização editorial e ACL

A allowlist contém exatamente dois permissionIds opacos configurados pelo servidor do teste. Não são e-mails, nomes ou claims enviados pelo visitante. A associação dessas IDs às identidades OIDC reais ainda **não foi implementada ou validada**.

Tipos de principal: user, group, domain, anyone. Papéis reconhecidos: owner, organizer, fileOrganizer, writer, commenter, reader. No cenário aprovado, somente os dois users podem existir nas ACLs examinadas, inclusive como leitores dos originais; os dois precisam ter capacidade de escrita na pasta editorial. Terceiro owner/writer/leitor, group/domain/anyone, papel desconhecido, permissionId repetido, deleted ou herança ambígua bloqueiam.

Inspeciona pasta, ancestrais e arquivo; não basta writers diretos. permissionDetails é validado quando presente, inclusive inheritedFrom contra a cadeia conhecida. Como My Drive pode não trazer inheritedFrom, a caminhada dos ancestrais permanece necessária. O comportamento efetivo de herança/visibilidade de Shared Drives e My Drive ainda precisa de prova real autorizada.

Presença na pasta editorial controlada representa aprovação editorial. O mock não prova quem colocou a foto; lastModifyingUser/changes.list não são usados para atribuir autor. Auditoria mantém humanActor=null. Não há painel obrigatório por fotografia.

Mudança para negado/indeterminado invalida jobs, bloqueia novas publicações/leitura e mantém pausa. Uma reconciliação posterior pode atualizar o inventário, mas a publicação não retoma automaticamente: exige resume local. Controle manual permissions allowed da fonte filesystem não substitui ACL do adaptador e é rejeitado quando a fonte fornece authorize().

## Retirada e falhas

- Parent fora da pasta ou trashed=true, confirmados individualmente após inventário completo: WITHDRAWN, revisão e tombstone.
- 404 do provedor: pode ser exclusão ou perda de acesso. Não converter em ENOENT; manter estado para investigação, bloquear leitura não verificável e não retirar todo o álbum.
- 403, 429, 5xx, timeout, partial e falha de ACL: não avançar checkpoint nem apagar índice. Erros não carregam mensagem privada, cabeçalhos ou configuração do provedor.
- Job antigo não supera geração/epoch/tombstone. Duplicata não promove cópia após retirar o canônico.
- Pause suspende publicações, preservando a reconciliação de retirada. Originais do mock não são modificados pelo adaptador.
- Não há retry automático HTTP, backoff de produção ou leitura de Retry-After neste marco. O scheduler local permite nova tentativa e o controle fica pausado quando a autorização passa a indeterminada; estratégia operacional e orçamento serão definidos antes da conexão real.

## Executar os testes

Na raiz do repositório:

```powershell
Set-Location tools/live-experience-local
npm.cmd run check
npm.cmd test
```

São 101 testes/subtestes: 33 anteriores e 68 novos. Zero dependências externas instaladas. A CLI padrão continua usando LocalSource; nenhum parâmetro ativa Google real.

Exemplo programático exclusivamente sintético, executado como módulo na pasta tools/live-experience-local:

```js
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Simulator } from './src/engine.mjs';
import { DriveSource } from './src/drive-source.mjs';
import { MockDriveClient, EDITORIAL, PUBLISHERS } from './test/drive-fixtures.mjs';

const client = new MockDriveClient();
client.add();
const source = new DriveSource({
  client, folderId: EDITORIAL, publisherPermissionIds: PUBLISHERS
});
const root = await mkdtemp(path.join(tmpdir(), 'level-xviii-drive-example-'));
const engine = await Simulator.open({ root, source, stableMs: 10 });
try {
  await engine.scan();
  await engine.pause(false);
  await delay(11);
  await engine.cycle();
  console.log(engine.snapshot()); // Apenas fotografia geométrica isDemo=true.
} finally {
  await engine.close();
}
```

Usar diretório separado da simulação filesystem anterior. O exemplo persiste estado no temporário e encerra; não inicia servidor. O cliente em memória não persiste originais entre processos: reconstruir a mesma origem sintética ao ensaiar novo processo.

## Limites e validações necessárias antes de Google real

- API simulada não demonstra semântica real de consulta/paginação, ACL, posse, Shared Drive, escopos, consentimento, quotas, Retry-After ou latência.
- Falta comprovar as duas identidades OIDC e sua associação privada a permissionIds, visibilidade completa de ACL, cadeia de ancestrais, grupos/administradores e isolamento do RSVP. Ator real de cada inclusão continua desconhecido.
- Confirmar tipo de conta, escopo mínimo e requisitos OAuth/verificação, sem credencial de conta RSVP. Definir provedor, região, custo, backup e operador.
- Cliente real precisará de streaming com limite durante transporte, cancelamento comprovado, retries/backoff/cotas e métricas. Aqui o Buffer já existe no mock; não é proteção de transporte real.
- Duplo inventário, downloads por ciclo e auditorias frequentes priorizam prova de correção. Medir custo e reduzir downloads com cache de versão validado ou feed/reconciliação antes de produção. Limites locais: 200 arquivos, 20 páginas por operação (configurável até 100), 500 permissões paginadas por recurso e 16 ancestrais.
- Mantêm-se PNG sintético, 8 MiB/4 MP e codec restrito do piloto. JPEG/WebP/HEIC, qualidade/orientação de fotografias reais e worker isolado precisam de implementação aprovada.
- JSON/locks locais não substituem banco transacional, fila distribuída ou backup independente. Persistência após crash de processo não equivale a garantia contra queda de energia.
- Código de álbum, sessão de leitura de produção, URLs/TTL, retenção e integração ao frontend seguem pendentes. Dados do mock não autorizam abrir uma pasta privada.
- O guard synthetic-drive-v3 deve ser revisto somente numa etapa explicitamente autorizada para conexão real; não inserir OAuth/segredos na CLI ou no repositório.

Referência de desenho: [Arquitetura aprovada](../../docs/ARQUITETURA_LIVE_EXPERIENCE.md). Os campos foram modelados usando a especificação já registrada no projeto; nenhuma consulta à internet foi feita neste marco. [Resultados](VALIDACAO_MARCO_04B_2.md).
