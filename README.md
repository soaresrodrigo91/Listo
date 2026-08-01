# Lista de Compras

App de listas de compras com espaço compartilhado (catálogo de itens, grupos, locais, formas de pagamento e listas sincronizados em tempo real entre membros convidados). Veja `ESPECIFICACAO.md` para a especificação completa do produto.

## Stack

- **App mobile (produto principal):** HTML/CSS/JS puro, sem build step, em `public/mobile/` — mesmo padrão do app mobile do Controle Financeiro. Firebase Authentication (e-mail/senha) + Cloud Firestore, via SDK modular carregado por CDN.
- **Páginas Next.js em `src/app/`:** primeira versão do produto, com um modelo de dados mais simples (compartilhamento por lista, não por espaço). Não foram atualizadas para o modelo atual — ver nota na `ESPECIFICACAO.md`.

## Rodando localmente

```bash
npm install
npm run dev
```

Abra http://localhost:3000/mobile para o app mobile, ou http://localhost:3000 para as páginas Next.js (v1). É necessário um arquivo `.env.local` com as credenciais do Firebase (veja `.env.local.example`) — pegue os valores em Firebase Console > Project settings > Your apps. O app mobile usa as mesmas credenciais, coladas diretamente em `public/mobile/app.js` (`FIREBASE_CONFIG`), como no Controle Financeiro.

Antes de usar, no Firebase Console:
1. Authentication > Sign-in method > ative Email/Password.
2. Firestore Database > crie o banco (modo produção).
3. Firestore Database > Rules > cole o conteúdo de `firestore.rules` > Publish.

## Status

App mobile: login/cadastro, espaço compartilhado com seeds de grupos/locais/formas de pagamento, cadastros (itens, grupos, locais, formas de pagamento), listas com carrossel e status, item com checkbox exigindo local+valor, histórico de preços e comparador, finalização de compra, lista permanente, compartilhamento por e-mail, dashboard, perfil. Próximas fases em `ESPECIFICACAO.md`.
