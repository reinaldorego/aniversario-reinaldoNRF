# Live Experience pelo Drive

Esta entrega implementa a conexão com uma pasta real por Google Apps Script. Você é o único publicador. Os convidados veem as prévias das imagens escolhidas. A pasta de envio permanece privada.

## Instalação no Windows

Extraia este ZIP na raiz de C:\Desenvolvimento\Projetos\aniversario-reinaldoNRF. No terminal dessa pasta, execute:

```powershell
node .\tools\live-experience-cloud\implantar.mjs
```

O assistente abre o Apps Script e copia os arquivos para a área de transferência, um por vez. Ele espera sua confirmação entre as etapas. Use a conta Google proprietária desta pasta:

https://drive.google.com/drive/folders/1pIkzwV1tzECAzIxunLrfI6UhNhVs1nUS

O código está dividido em Código.gs/Code.gs, Galeria.html e appsscript.json. Crie um projeto separado chamado LIVE EXPERIENCE - Reinaldo 18. A autorização solicita drive.readonly, que tecnicamente permite ler todo o Drive da conta, e userinfo.email para identificar o operador. O código seleciona somente a pasta configurada. Este consentimento pertence ao novo Apps Script.

Depois de autorizar configurarGaleria e receber CONFIGURACAO_APROVADA, implante como Aplicativo da Web, executando como Você, com acesso Qualquer pessoa. Execute obterLinkGaleria e use o endereço completo que termina em /exec?album=... no assistente. O parâmetro album funciona como chave de leitura compartilhada com quem recebe o convite.

Se interromper após a implantação, retome apenas a ativação local:

```powershell
node .\tools\live-experience-cloud\ativar.mjs
```

O ativador substitui live-experience/app.js e a referência desse módulo em live-experience/index.html, cria live-experience/config.json e incrementa a versão existente do service worker. Faz um backup externo dos arquivos substituídos e imprime o caminho. A raiz dos arquivos extraídos é determinada pela posição do script.

## Enviar e retirar fotos

No celular, abra o aplicativo Google Drive na conta proprietária da pasta, entre em LEVEL XVIII - PUBLICAR NA GALERIA e envie as imagens escolhidas. Qualquer foto elegível colocada diretamente nessa pasta ficará disponível para quem tem o link da galeria.

São reconhecidos JPEG, PNG, WebP e HEIC/HEIF quando o Drive gerar uma prévia. A primeira prévia pode demorar a ser gerada. PDFs, atalhos, arquivos em subpastas e imagens com compartilhamento individual são ignorados.

A galeria consulta novamente a lista a cada 60–70 segundos enquanto a página está visível e o visualizador está fechado. O botão Atualizar continua disponível. O índice do servidor tem cache de até 30 segundos. Novos envios e retiradas, portanto, podem levar cerca de 100 segundos para aparecer automaticamente, além do tempo de geração das prévias pelo Google.

Para retirar uma imagem, mova-a para fora da pasta ou coloque-a na lixeira. O serviço verifica a presença e a versão antes de entregar uma prévia, inclusive quando a prévia está em cache. Imagens já vistas ou salvas no aparelho de um convidado continuam sob o controle desse aparelho.

## Publicação do convite

A implantação do Apps Script fornece imediatamente um endereço online para a galeria. A ligação pelo convite passa a valer no site publicado quando a publicação incluir live-experience/app.js, live-experience/index.html, live-experience/config.json e sw.js atualizados.

O iframe exibe a galeria no visual existente e ajusta sua altura. O link Abrir galeria em outra aba também fica disponível. A navegação de retorno do convite conserva seu contexto no documento externo.

## Limites da opção gratuita

A versão apresenta as prévias fornecidas pelo Google Drive, cuja resolução é definida pelo Google. O visualizador amplia essas mesmas prévias. Não existe entrega de originais ou promessa de alta resolução nesta versão.

O álbum comporta até 200 imagens elegíveis diretamente na pasta. O serviço usa cache e o cliente carrega duas prévias de cada vez. No entanto, o Apps Script possui cotas por conta, incluindo limite de execuções simultâneas. Acima dessas cotas, a galeria informa indisponibilidade e pode ser atualizada depois. Não há contratação de serviço pago, configuração de faturamento ou garantia de capacidade ilimitada.

Quem tiver o link da galeria poderá ver as prévias. A chave no link não identifica convidados individualmente e pode ser repassada. A autorização de escrita continua sendo a conta proprietária no aplicativo Drive.

## Validação desta entrega

Foram verificadas a autorização do proprietário, lista de imagens da pasta, IDs opacos, entrega da prévia, remoção de EXIF/texto, retirada, alteração de versão, rejeição de pasta compartilhada, sanitização de erros e limites. O frontend foi exercitado com DOM e RPC simulados. Essas verificações não substituem o consentimento e a execução no Google da sua conta.

A pasta real foi criada e seus metadados mostraram shared=false e apenas uma permissão de proprietário. O projeto Apps Script e seu endereço de implantação dependem da execução do assistente na conta Google. A leitura de fotos reais e o funcionamento visual dessa implantação permanecem pendentes até a ativação.

## Fontes oficiais

- Google Apps Script — https://developers.google.com/apps-script/overview
- Aplicativos da Web — https://developers.google.com/apps-script/guides/web
- Comunicação com o servidor — https://developers.google.com/apps-script/guides/html/communication
- Cotas — https://developers.google.com/apps-script/guides/services/quotas
- Prévia do Drive — https://developers.google.com/apps-script/reference/drive/file#getThumbnail()
- Serviço avançado Drive — https://developers.google.com/apps-script/advanced/drive
