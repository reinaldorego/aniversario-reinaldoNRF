# LEVEL XVIII — PWA (protótipo visual)

## Dados
- Reinaldo NR Filho
- 18 anos
- 15/11/2026 às 20:00
- Ed. Dhahram
- Trav. Vileta, 1197
- Até 3 acompanhantes
- RSVP até 01/11/2026

## Como testar
A PWA precisa ser servida por HTTP/HTTPS para Service Worker funcionar.

### Opção simples no VS Code
Use a extensão Live Server e abra `index.html`.

### Python
Na pasta do projeto:
`python -m http.server 8000`

Depois acesse:
`http://localhost:8000`

## Estado desta versão
- Layout responsivo
- Abertura cinematográfica
- Contagem regressiva
- Botão de localização
- RSVP simulado
- Access Pass simulado
- Dados salvos apenas em localStorage

Próxima etapa recomendada:
Google Sheets / Apps Script + QR real individual + painel de check-in.
