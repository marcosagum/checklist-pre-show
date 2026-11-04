# Checklist Operacional · Farmasi Arena

Checklist de pré-show: modelo fixo editável e um checklist por show, com status (feito, não feito, N/A) e observações.

- `public/pagina.html`: a página inteira (funciona aqui e também como artifact no claude.ai).
- `server.js`: servidor sem dependências (Node 20). Guarda tudo em `DADOS_DIR/checklists.json` e faz uma cópia por dia em `DADOS_DIR/copias` (últimas 30).
- `inicial.json`: dados usados só na primeira vez que o servidor sobe com o volume vazio.

## Coolify
- Build pack: Dockerfile. Porta: 3000.
- Volume persistente montado em `/app/dados` (sem ele os checklists somem a cada deploy).
- Variável `SENHA`: senha da equipe. Só marca itens (Feito, Não feito, N/A) e escreve observações.
- Variável `SENHA_ADMIN`: senha de administrador. Cria e exclui checklists, edita itens e o modelo, marca como concluído. Sem ela, a `SENHA` continua dando acesso total.

## Rodar no computador
`SENHA=equipe SENHA_ADMIN=admin node server.js` e abrir http://localhost:3000

## Modelos de montagem
Aba "Montagens": cada modelo tem nome, nível (0 a 3), fotos, lista de grades/material (tipo, ferro ou inox, com ou sem capa, quantidade) e o desenho na planta: grade (linha), baia de grade (corredor de dois toques, com largura ajustável), pranchão e recolha de alimento (adesivos), cada marcação com quantidade e observação (a soma pode ir para a quantidade do material). Os pórticos são fixos da casa: marcados uma vez por nível (config/fixos) e mostrados em todas as montagens. A planta abre em tela cheia, com zoom por botão, dois dedos ou Ctrl + rolagem. Um item do checklist pode ser ligado a um modelo (em "Editar itens" ou na aba Modelo); no show, o item mostra "Ver montagem" e o quadro "Material do show" soma tudo. A quantidade pode ser ajustada só para um show.

Fotos e plantas ficam em `DADOS_DIR/fotos` e `DADOS_DIR/plantas`, no volume, e só abrem com senha. **Nunca coloque plantas ou fotos no repositório**, que é público. Só o administrador envia ou muda.
