# LIVE EXPERIENCE — piloto local 04B.1

Prova de sincronização **inteiramente local e sintética**, isolada do convite. Não conecta Google Drive, Apps Script, Sheets, internet, frontend ou convidados. Não é backend de produção nem autenticação de publicadores/leitores. A numeração 04B.1 desta entrega segue o pedido atual: corresponde à prova local prevista como 04B.0 no plano 04A.2, sem executar a etapa de conexão real ali chamada 04B.1.

## Instalar e testar

Requer Node.js **24.x**; validado com v24.21.0 e npm 11.19.0 em Windows. Não há dependências de terceiros: **não precisa executar npm install**, baixar pacote, criar conta ou credencial. package.json é privado; não há package-lock porque não há árvore de dependências a instalar.

Na raiz do projeto:

```powershell
Set-Location tools/live-experience-local
node --version
npm.cmd run check
npm.cmd test
npm.cmd run seed
npm.cmd start
```

No PowerShell deste ambiente, npm.ps1 é bloqueado pela política de execução; npm.cmd funciona sem alterar essa política. Em outro shell, npm run check/test/start também pode ser usado.

seed inicializa o armazenamento e gera três PNGs geométricos identificados como sintéticos em 01_ORIGINAIS. Nenhuma imagem privada é lida. Seed repetido não sobrescreve arquivos existentes. init inicializa sem gerar imagens. status, com o servidor parado, mostra estado resumido.

## Iniciar, publicar exemplos e interromper

O endereço padrão é http://127.0.0.1:8787/v1/photos. O console mostra o diretório real dos dados, fora do repositório, e a advertência permanente de simulador. No console do processo iniciado:

```text
permissions allowed
resume
demo
status
```

permissions escolhe apenas um **cenário simulado**, sem validar conta/ACL real. resume é o comando local de ativação/reendosso do conjunto sintético. demo copia exclusivamente os três arquivos SYNTHETIC gerados por seed para a pasta editorial. Com ciclos padrão de 2 s e estabilidade mínima de 1 s, aguardar pelo menos duas observações; não há prazo de produção garantido. Atualizar o JSON no navegador para conferir as três publicações.

Outros comandos do mesmo console:

| Comando | Efeito |
| --- | --- |
| pause | Suspende novas publicações, inclusive conclusão de job em voo; retirada continua. |
| resume | Reativa após permissões allowed; não contorna validação. |
| permissions denied | Simula ACL negada; pausa e bloqueia leitura/publicação. |
| permissions indeterminate | Simula ACL desconhecida; mesmo bloqueio seguro. |
| permissions allowed | Simula ACL permitida; não retoma sozinho após incidente. |
| listing incomplete / listing error | Simula inventário incompleto/falha, sem transformar lista em exclusão em massa. |
| listing complete | Volta ao cenário de listagem normal. |
| scan | Solicita ciclo manual sem concorrência com o ciclo corrente. |
| retry | Reabilita FAILED para nova validação, até três tentativas por geração. |
| status | Exibe contagens, pausa, permissões, revisão e frescor, sem originais/caminhos. |
| quit | Fecha API, aguarda ciclo e libera lock. |

Ctrl+C ou SIGTERM também encerram com fechamento do armazenamento. Não fica serviço instalado ou processo iniciado automaticamente no sistema. Reiniciar com npm.cmd start usa os mesmos dados e exige reconciliação completa antes de voltar a ler fotos.

Para testar retirada, mova SYNTHETIC-1.png de 02_PUBLICAR_NA_GALERIA para 03_RETIRADAS no diretório informado. Pode usar o Explorador ou outro terminal PowerShell, preenchendo o caminho exibido:

```powershell
$dadosPiloto = 'CAMINHO_EXIBIDO_EM_DATA_DIRECTORY'
Move-Item -LiteralPath (Join-Path $dadosPiloto '02_PUBLICAR_NA_GALERIA/SYNTHETIC-1.png') -Destination (Join-Path $dadosPiloto '03_RETIRADAS/SYNTHETIC-1.png')
```

No próximo inventário completo, a foto sai da API e a mídia retorna 404. O original continua intacto em 03. Copiar arquivo de mesmo hash não promove outra foto depois da retirada. Republicar os mesmos bytes retirados requer futuro fluxo explícito; não existe comando para apagar tombstones neste piloto.

## Configuração

Variáveis opcionais, definidas somente na sessão que inicia o processo:

| Variável | Padrão / limite |
| --- | --- |
| LEVEL_LOCAL_DATA_DIR | Diretório estável em os.tmpdir(), com sufixo derivado do caminho do repositório. Deve ser exclusivo do piloto e fora do repositório. |
| LEVEL_LOCAL_PORT | 8787; apenas 127.0.0.1. Porta 0 permite escolha livre para testes. |
| LEVEL_LOCAL_SCAN_MS | 2000 ms; 50–60000 ms. Scheduler local sem sobreposição. |
| LEVEL_LOCAL_STABLE_MS | 1000 ms; mínimo 1 ms, mais duas observações distintas. |

Frescor local = máximo de 15 s, três intervalos de varredura e duas janelas de estabilidade. É um lease acelerado para ensaio, diferente da hipótese de cinco minutos da arquitetura futura. Após falha, o estado não é apagado; a leitura deixa de entregar fotos quando o lease vence. Nova publicação exige último inventário completo sem erro.

Dados temporários sobrevivem ao reinício do processo, mas podem ser removidos pelo sistema operacional; não constituem armazenamento durável de produção. Para demonstrar maior retenção, escolher diretório externo autorizado. Não usar o diretório de uma instalação existente nem apontar para assets ou live-experience.

## Arquitetura implementada

```text
01_ORIGINAIS (fixtures sintéticas)
        |
        | cópia/movimentação local intencional
        v
02_PUBLICAR_NA_GALERIA
        |
LocalSource: inventário completo + leitura limitada + fingerprint
        |
Simulator: estabilidade + cenário de permissões + SHA-256/canônico
        |
job persistido -> PROCESSING -> decodificar/gerar/verificar derivados
        |
READY -> revalidar origem, geração, pausa, epoch e frescor -> PUBLISHED
        |
API GET somente de publicados / mídia local validada
        |
retirada -> WITHDRAWN + tombstone; original em 03 opcional
```

| Arquivo | Responsabilidade |
| --- | --- |
| src/local-source.mjs | Adaptador de filesystem; arquivos diretos, sem seguir symlinks/subpastas, limite de leitura. |
| src/engine.mjs | Estados, estabilidade, jobs, canônico SHA-256, revisão/tombstones, pausa, reconciliação e API de domínio. |
| src/storage.mjs | JSON com checksum, gravação temporária/sync/rename e exclusão entre instâncias por lock de processo. |
| src/png.mjs | Codec de perfil PNG restrito, integridade/limites, redimensionamento e reencodificação sem metadados. |
| src/fixtures.mjs | Padrões geométricos com marcador sintético e EXIF/GPS artificiais para teste. |
| src/http.mjs | API loopback somente leitura; Host exato, sem CORS e com bloqueio de Origin. |
| src/cli.mjs | Comandos locais, agendamento e encerramento; sem painel/login fictício. |
| test/simulator.test.mjs | T01–T14 e cenários adicionais de recuperação/isolamento. |
| test/preservation-baseline.json | SHA-256 dos 31 arquivos preexistentes no commit e12f90e, sem conteúdo privado. |
| scripts/check.mjs | Verificação de sintaxe de todos os JS do módulo. |

Estados requeridos: RECEIVED, PROCESSING, READY, PUBLISHED, WITHDRAWN, FAILED. Estabilidade e duplicidade são atributos de RECEIVED, sem fingir publicação. Job e estado ficam no mesmo snapshot persistido. Uma única instância escreve; callbacks antigos não superam geração/retirada/epoch. Crash em PROCESSING devolve job à fila, após novo inventário completo; efeitos são idempotentes, sem promessa de processamento exactly-once.

Pausa em voo conserva READY, mas não publica. A retomada pode reutilizar derivados verificados. Alteração binária suspende a geração antiga e exige nova validação. Duplicatas não geram segundo card; hash retirado não ressuscita por cópia, reinício ou callback. Não há reconhecimento facial.

## Validação de imagens e integridade

Aceita somente arquivo .png, assinatura PNG, 8 bits RGB/RGBA, estático, não entrelaçado, até **8 MiB e 4 megapixels**, no máximo 256 chunks, com marcador de fixture sintética. Proíbe JPEG/WebP/HEIC/RAW/SVG/APNG e outros perfis nesta prova; os formatos planejados na arquitetura continuam pendentes de processador de produção.

Verifica CRC de todos os chunks, dimensões, estrutura suportada, limites de inflate, consumo do stream e decodificação integral. Duas observações de SHA-256/tamanho/mtime/inode precisam estabilizar; depois, reconsulta antes de publicar. Checksum não prova autoria. Marcador sintético previne uso acidental: **não é credencial nem detector infalível de foto privada**.

Derivados reais PNG: thumbnail até 160 px e display até 640 px, sem upscaling, usando amostragem simples adequada a padrões geométricos. Reencodifica somente IHDR/IDAT/IEND: elimina todos os chunks EXIF/GPS/texto e verifica bytes/dimensões. Objetos são gravados completos por temporário + rename; originais não são alterados. Não é tratamento fotográfico/correção de cor/orientação EXIF para acervo real. Nenhuma imagem deste módulo representa foto da festa.

## API local

| Rota GET | Resposta |
| --- | --- |
| /health | Status sanitizado, sempre marcado SYNTHETIC_LOCAL_ONLY. |
| /v1/photos | Snapshot isDemo=true; somente PUBLISHED elegíveis e dentro do frescor. |
| /v1/media/{id}/thumbnail | Derivado do publicado, checksum conferido; caso contrário 404. |
| /v1/media/{id}/display | Mesmo gate, sem URL de original. |

Demais rotas retornam 404; escrita HTTP retorna 405. Origem presente ou Host diferente do loopback exato recebe 403. No-store e no-referrer; sem serviço de arquivos estáticos, upload, endpoint de original, autenticação fingida ou integração com Service Worker. A API não é conectada ao frontend existente.

O código do álbum e OIDC dos publicadores **não estão implementados**: não expor este servidor além do loopback, não usar túnel/reverse proxy e não carregar fotografias pessoais nele. Comandos de console representam controle do operador local; qualquer usuário/processo com acesso ao sistema de arquivos está na fronteira de confiança. Permissões Windows são herdadas do diretório; os bits POSIX não provam ACL privada no Windows.

## Limites e migração futura

1. Trocar LocalSource por adaptador Drive com paginação/completude, version/checksum/parents e rechecagem individual, preservando invariantes. Implementar ACL direta/herdada real, duas identidades comprovadas, OAuth isolado, bootstrap/reconciliação e política de certificação.
2. Escolher provedor/banco/fila/cofre e locks/transações distribuídos. Lock de PID é somente local; se recuperação interromper com recovery.lock ou lock inválido, parar e revisar manualmente, sem forçar reset. PID reutilizado pode bloquear recuperação até revisão.
3. Implementar código de álbum e OIDC/allowlist verdadeiros, antes de conteúdo real. Exigir política de mídia/retirada/TTL, logs e orçamento aprovados.
4. Substituir codec de teste por biblioteca/worker de imagens mantidos e isolados, com formatos e limites homologados; justificar dependências e medir qualidade/CPU. Não levar este parser de perfil restrito diretamente para produção.
5. Persistência por rename + checksum detecta corrupção acidental; não autentica arquivo contra alteração por usuário local nem substitui banco transacional, backup independente ou garantia contra queda de energia. Corrompido/ausente com dados existentes falha fechado e não apaga retiradas.
6. Limite de 200 arquivos diretos e worker único; auditoria/jobs/derivados se acumulam, sem limpeza automática. Não é teste de escala para convidados ou medição de latência Drive.
7. Ações entre duas varreduras podem não ser observadas. Filesystem e índice não têm transação conjunta; existe janela residual após a última leitura e antes do commit. Não afirmar autoria humana ou instante exato de publicação.
8. Originais e artefatos órfãos permanecem no diretório de teste. Falhas de leitura/listagem não equivalem a exclusão; última leitura autorizada só persiste no lease. Em incidente de permissão, bloqueio é imediato no simulador.

Aprovação deste piloto não escolhe provedor, acessa Drive, cria serviços, autentica identidades reais ou autoriza publicação. Convite, galeria, RSVP, Access Pass/QR/check-in, SW, manifest e Documento Mestre preservados.

Referências de implementação: [PNG/W3C](https://www.w3.org/TR/png-3/), [Node zlib](https://nodejs.org/docs/latest-v24.x/api/zlib.html), [Node test runner](https://nodejs.org/docs/latest-v24.x/api/test.html). [Resultado da validação](VALIDACAO_MARCO_04B_1.md).
