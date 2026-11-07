# LIVE EXPERIENCE — Marco 03

Galeria de leitura em HTML/CSS/JavaScript, sem dependências de instalação. Sirva a raiz do repositório por HTTP, por exemplo com `python -m http.server 8000`.

## Rotas e separação de conteúdo

- `live-experience/`: página pública. A fonte atual retorna **Em breve**, sem fotografias, conexão com backend ou acesso a dados de convidados.
- `live-experience/demo/`: demonstração explícita, com ilustrações vetoriais de teste, aviso permanente, marca DEMO em cada imagem e `noindex`. Não é ligada pelo convite e não é incluída no pré-cache.
- A demonstração é uma rota estática acessível a quem souber o endereço; `noindex` e a separação de rotas **não são autenticação**. Não colocar imagens privadas, convidados ou credenciais nela.
- Nenhum parâmetro da URL pública habilita dados demonstrativos.

## Organização

- `app.js`: inicializa a fonte pública e a interface.
- `navigation.js`: preserva apenas `token` e `confirmado` no retorno ao convite. O token de RSVP não autentica a galeria.
- `data-source.js`: contrato de leitura e normalização dos registros. Não importa arquivos de demonstração.
- `gallery.js`: estados, atualização, lotes de seis prévias, falhas individuais e visualizador nativo `dialog`.
- `demo/data-source.js`: fonte exclusiva de testes. Oferece os seis cenários do seletor e acrescenta um exemplo a cada atualização bem-sucedida, até 12.

## Contrato para a futura fonte de leitura

`source.list({ signal })` retorna uma Promise com:

```js
{
  phase: "coming-soon", // ou "open"
  isDemo: false,
  updatedAt: null, // reservado à data de publicação do backend
  photos: []
}
```

Cada fotografia publicada deve ter `id`, `status: "published"`, `thumbnailUrl`, `imageUrl`, `width`, `height`, `alt`, `caption` e `publishedAt` em formato ISO. Registros com outros estados são ignorados. Os registros são ordenados cronologicamente. IDs duplicados, metadados inválidos e URLs fora de HTTP/HTTPS são rejeitados. Textos são inseridos por `textContent`.

O frontend oferece somente leitura. Filtrar estados e rejeitar demonstrações na interface é defesa adicional, **não controle de autorização**. A futura API deverá entregar somente registros autorizados e validar o acesso no servidor.

## Comportamentos

- Atualização manual sem recarregar a página. Não há polling nem sincronização automática neste marco.
- Previews com dimensões reservadas, carregamento nativo sob demanda e botão para carregar o próximo lote.
- Erro de atualização preserva as imagens anteriores e informa que não houve atualização confirmada.
- Uma prévia com erro continua acionável. O visualizador permite tentar novamente.
- Visualizador: anterior/próxima, setas do teclado, Escape, botão de fechar, foco modal e retorno ao botão de origem.
- Timeout de 15 segundos. Uma nova solicitação aborta a anterior para impedir respostas fora de ordem.
- Respeita `prefers-reduced-motion`. A hora exibida é a última verificação neste aparelho, sem alegar sincronização ao vivo.

## Testes manuais

Na demonstração, testar imagens, Em breve, vazio, carregando, erro e falha em uma imagem. No erro de atualização, as imagens já carregadas devem continuar acessíveis. Trocar de cenário durante o carregamento deve cancelar a solicitação anterior.

Abrir uma imagem por Enter; navegar com setas e botões; conferir Tab/Shift+Tab dentro do diálogo; fechar por Escape e pelo botão. Testar atualização e lotes adicionais nas larguras 320, 375, 390, 430, 768 e 1280 px. Conferir retorno com e sem contexto de confirmação usando apenas identificadores sintéticos locais.

## Cache e operação

O Service Worker da raiz inclui somente os arquivos públicos da galeria no cache `level-xviii-v7`. APIs, imagens futuras e a rota de demonstração seguem para a rede. O fallback offline público é a apresentação Em breve. A demonstração não promete funcionamento offline.

## Pendências para Google Drive

Definir backend, política de leitura, retenção, backup, volume de imagens e meta de atualização. Manter originais privados no Drive e publicar prévias otimizadas por serviço controlado. A autenticação e autorização de organizador/fotógrafo, o índice de publicações e a retirada de imagens deverão ser implementados no servidor, separados do RSVP e sem permissão de escrita sobre convidados/check-ins. Não existe upload, painel administrativo ou autenticação neste marco.
