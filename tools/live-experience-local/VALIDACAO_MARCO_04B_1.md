# Validação — piloto local 04B.1

Base: branch feature/live-experience, HEAD e12f90ee383ac85c6f861b16585a6c83ea2402a3. Node v24.21.0, npm 11.19.0, Windows/PowerShell. Somente imagens geométricas sintéticas; sem Drive ou convidados.

## Comandos e resultado

- `npm.cmd run check`: sintaxe válida em 9 arquivos JavaScript.
- `npm.cmd test`: **33 testes/subtestes aprovados, zero falhas, cancelamentos ou skips**; 21 cenários principais. Execução completa final do código: aproximadamente 5,24 s no test runner, sem alegar benchmark de produção.
- Teste CLI end-to-end: seed → start → permissões simuladas → resume → demo → três fotos na API → pause → quit, processo encerrado com código 0.
- T12: os 31 arquivos preexistentes mantêm SHA-256 idênticos à baseline; inclui convite, galeria, SW/manifest, assets e documentos anteriores.

## Resultados individuais obrigatórios

| ID | Resultado | Evidência automatizada |
| --- | --- | --- |
| T01 | PASSOU | RECEIVED → PROCESSING → READY → PUBLISHED só depois de duas observações estáveis; um publicado. |
| T02 | PASSOU | Repetir ciclos/copiar bytes gera um processamento, uma revisão e um card; duplicata não promove após retirada. |
| T03 | PASSOU | Arquivo cresce entre observações e não publica; somente versão íntegra estabilizada entra. |
| T04 | PASSOU | Oito casos negativos: assinatura, extensão, CRC, truncamento, tamanho, dimensões excessivas, ausência de marcador sintético e bytes extras. |
| T05 | PASSOU | Negado/indeterminado bloqueiam; mudança de permissão durante job impede publicação; allowed não retoma sozinho. |
| T06 | PASSOU | Lista parcial vazia/falha de leitura preservam estado PUBLISHED e revisão, sem retirada em massa. |
| T07 | PASSOU | Movimentação para 03 gera WITHDRAWN/tombstone, revisão 2 e mídia indisponível. |
| T08 | PASSOU | Job em voo e callback antigo após retirada retornam STALE, sem republicar. |
| T09 | PASSOU | Processo filho encerra após claim persistido PROCESSING; nova instância recupera lock/job, reconcilia e publica; novo reinício não duplica; retirada também persiste. |
| T10 | PASSOU | Pausa persiste ao reiniciar, retomada publica, retirada continua durante pausa; job em voo fica READY e reaproveita derivados sem novo processamento. |
| T11 | PASSOU | Falha injetada gera FAILED; retry recupera com um publicado e sem duplicação. |
| T12 | PASSOU | Comparação byte a byte por SHA-256 de todos os 31 arquivos anteriores. |
| T13 | PASSOU | API só entrega publicados, sinaliza isDemo, serve derivado; após retirada responde 404; nega POST e Origin externo. |
| T14 | PASSOU | Original preserva hash; derivados menores têm dimensões limitadas, chunks somente IHDR/IDAT/IEND, pixels esperados e nenhuma metadata EXIF/GPS. |

## Resultados adicionais

| ID | Resultado |
| --- | --- |
| T15 | Estado corrompido falha fechado, preservando o arquivo para investigação. |
| T16 | Segunda instância e diretório de dados na árvore pública rejeitados. |
| T17 | Frescor vencido impede leitura; reconciliação restaura leitura elegível sem apagar estado. |
| T18 | Artefato parcial/corrompido é regravado integralmente e verificado antes de publicar. |
| T19 | Substituição de bytes retira geração antiga e só publica nova após estabilidade/processamento. |
| T20 | Operação real da CLI, HTTP e encerramento, com pausa persistida. |
| T21 | Extensão proibida não reserva o hash nem impede o processamento de PNG válido idêntico. |

## O que foi e não foi comprovado

Comprovados localmente: persistência entre processos, idempotência de efeitos, retirada/replay, bloqueio por cenário de permissões, controle de pausa e recuperação de processamento. T09 simula crash de processo, não perda de energia/disco. T14 inspeciona estrutura/pixels de derivados reais, não qualidade fotográfica de câmera.

Não comprovados: Google Drive/ACL/OAuth reais, identidade dos dois publicadores, código de álbum, autenticação de produção, acesso em celulares de convidados, carga simultânea, quotas/custos externos, backup independente, TLS, CDN e latência fim a fim. Isso permanece pendente de etapa aprovada.

Dados dos testes são criados em diretórios únicos no temporário e removidos ao término; nenhum original do projeto é alterado. Nenhum servidor do piloto permanece iniciado pela suíte. Não houve commit, push, merge, deploy ou modificação de documento anterior.
