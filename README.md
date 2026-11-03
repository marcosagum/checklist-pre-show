# Checklist Operacional · Farmasi Arena

Checklist de pré-show: modelo fixo editável e um checklist por show, com status (feito, não feito, N/A) e observações.

- `public/pagina.html`: a página inteira (funciona aqui e também como artifact no claude.ai).
- `server.js`: servidor sem dependências (Node 20). Guarda tudo em `DADOS_DIR/checklists.json` e faz uma cópia por dia em `DADOS_DIR/copias` (últimas 30).
- `inicial.json`: dados usados só na primeira vez que o servidor sobe com o volume vazio.

## Coolify
- Build pack: Dockerfile. Porta: 3000.
- Volume persistente montado em `/app/dados` (sem ele os checklists somem a cada deploy).
- Variável `SENHA`: senha da equipe para entrar.

## Rodar no computador
`SENHA=teste node server.js` e abrir http://localhost:3000
