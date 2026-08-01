# Lista de Compras — Especificação do App

App de listas de compras domésticas com **espaço compartilhado**: catálogo de produtos, grupos, locais de compra, formas de pagamento e listas de compras vivem dentro de um "espaço" que pode ter mais de um membro (ex.: casal). Convidar alguém por e-mail coloca a pessoa no mesmo espaço — a partir daí os dois veem exatamente as mesmas listas, os mesmos itens, os mesmos grupos e os mesmos locais, sincronizados em tempo real.

Este documento substitui a v1 (modelo de "membros por lista"). Veja a nota no fim sobre o que ficou desatualizado.

## 1. Produto e stack

O produto principal é um **app mobile web (PWA)** em HTML/CSS/JS puro (sem framework, sem build step), no mesmo padrão do app mobile do Controle Financeiro (`ControleFinanceiro/public/mobile`): uma tela por `<div class="screen">`, navegação por troca de classe `hidden`, drawer lateral, FAB, Firebase via CDN (módulos ES).

- **App mobile:** `public/mobile/index.html` + `style.css` + `app.js`, servido também pela mesma hospedagem do projeto Next.js (rewrite `/mobile` → `/mobile/index.html`).
- **Autenticação:** Firebase Authentication (e-mail/senha).
- **Banco:** Cloud Firestore, sincronização em tempo real via `onSnapshot`.
- **As páginas Next.js criadas numa primeira versão** (`src/app/...`) usavam um modelo de dados mais simples (compartilhamento por lista individual) e **não foram atualizadas** para o modelo de espaço compartilhado abaixo — ficaram desatualizadas em relação a este documento. O app mobile é a referência atual.

## 2. Espaço compartilhado

- No cadastro, cada usuário ganha automaticamente um **espaço próprio** (`espacos/{espacoId}`), do qual é o único membro e criador.
- O espaço já nasce com grupos, locais e formas de pagamento pré-cadastrados (ver seeds abaixo).
- Convidar alguém por e-mail: se a pessoa aceitar, ela passa a ter aquele espaço como **espaço ativo** (`usuarios/{uid}.espacoId` é atualizado) e é adicionada a `espacos/{espacoId}.membros`. A partir daí enxerga o catálogo e as listas desse espaço, não mais o espaço que tinha antes (que continua existindo no banco, apenas fica sem uso).
- Não há hierarquia entre membros de um espaço — qualquer membro cadastra itens, grupos, locais, cria/edita listas e marca compras.

## 3. Modelo de dados (Firestore)

```
usuarios/{uid}
  nome, sobrenome, telefone, fotoUrl, email
  espacoId              // espaço ativo do usuário
  criadoEm

indiceEmails/{emailNormalizado}
  uid                   // localizar uid pelo e-mail, para convidar

espacos/{espacoId}
  criadoPor, criadoEm
  membros: string[]
  membrosInfo: { [uid]: { nome, email } }

  grupos/{grupoId}
    nome, descricao

  locais/{localId}
    nome, endereco, cidade, site      // link do supermercado, com botão "Abrir site" no cadastro

  formasPagamento/{formaId}
    nome

  unidadesMedida/{unidadeId}
    nome

  estatisticas/geral                   // contadores incrementados a cada item marcado como comprado
    itens: { [itemId]: contagem }
    grupos: { [grupoNome]: contagem }
    locais: { [localId]: contagem }

  itens/{itemId}                       // catálogo único de produtos
    nome, descricao, marca, grupoId, unidade
    fotoUrl                            // data URL (base64), opcional — sem Firebase Storage
    // Sem valor de referência no cadastro — o preço só existe depois de uma compra real
    // registrada numa lista (ver historicoPrecos abaixo); "quanto custa" é sempre por local.
    historicoPrecos/{registroId}       // 1 registro por compra confirmada
      localId, valor, data, listaId

  listas/{listaId}
    nome, observacoes                    // sem data prevista — a lista não tem data de criação/compra
                                        // planejada, só a data/hora real em que foi concluída (finalizadaEm)
    permanente: boolean                // lista contínua, sem data de finalização fixa — modelo legado,
                                        // não há mais opção no formulário para criar uma nova assim
    status: "pendente" | "parcial" | "comprada"
    qtdItens, qtdComprados, valorProvisionadoTotal   // agregados, recalculados a cada alteração de item
    criadoPor, criadoEm
    finalizadaEm, formaPagamentoId, parcelas, valorTotalPago   // preenchidos ao finalizar
                                                                // finalizadaEm = serverTimestamp() (data e hora reais da conclusão)

    itensLista/{itemListaId}
      itemId, nome, unidade, grupoNome         // denormalizado do catálogo no momento da inserção
      quantidade, valorProvisionado, subtotal  // subtotal = quantidade * valorProvisionado
      adicionadoPor, adicionadoPorNome         // quem inseriu o item (exibido quando o espaço tem 2+ membros)
      comprado: boolean
      localCompraId, valorPago, compradoPor, compradoEm

convites/{espacoId}_{emailNormalizado}         // ID determinístico (mesmo motivo da v1: rules com get())
  espacoId, deUid, deEmail, paraEmail, paraUid, status, criadoEm

notificacoes/{id}                              // aparecem no sino do topbar
  tipo: "convite_recebido" | "convite_aceito"
  uidDestino, espacoId, mensagem, criadoEm, lida
  paraEmail                                    // só em "convite_recebido" (usado pela rule)
```

### Seeds do espaço novo (criados no cadastro)

**Grupos:** Higiene Pessoal, Limpeza, Verduras e Frutas, Carnes, Padaria, Bebidas, Laticínios, Congelados, Utilidades Domésticas, Temperos.

**Locais:** Supermercados BH, Villefort, Mart Minas, Center Pão.

**Formas de pagamento:** PIX, Dinheiro, Cartão de Débito, Cartão de Crédito, Flash.

**Unidades de medida:** Bandeja, Caixa, Dúzia, Fardo, Frasco, Garrafa, Gramas, Kg, Lata, ml, Rolo, Saco, Unidade.

## 4. Regras de negócio

1. **Item do catálogo é único** (`espacos/{id}/itens`): campos obrigatórios nome, grupo, unidade. Não tem valor de referência — o preço só passa a existir depois da primeira compra registrada (ver histórico de preços por local).
2. **Ao adicionar um item a uma lista**, o app copia nome/unidade/grupo do catálogo para `itensLista` (denormalizado); não há campo manual de valor — o valor provisionado é preenchido automaticamente com o preço mais recente já registrado no histórico desse item (0 se nunca foi comprado).
3. **Nome, Grupo e Unidade sempre em campo de texto com sugestão** (nunca `<select>` pré-selecionado): nada vem pré-selecionado, só conta como escolhido quando uma sugestão é clicada. Grupo e Unidade são listas pequenas e fechadas — ao focar o campo (mesmo vazio), já mostram todas as opções cadastradas em `grupos`/`unidadesMedida`, filtrando conforme o usuário digita. O campo "Item" (catálogo e ao adicionar numa lista) só sugere a partir de 1-2 caracteres digitados, já que o catálogo pode crescer bastante.
4. **Subtotal e totais em tempo real:** cada `itensLista` tem `subtotal = quantidade × valorProvisionado`; a lista mantém `qtdItens`, `qtdComprados` e `valorProvisionadoTotal` recalculados a cada escrita em `itensLista` (feito pelo cliente, não por Cloud Function).
5. **Status da lista:** `pendente` (nenhum item comprado), `parcial` (0 < comprados < total), `comprada` (todos comprados e total > 0). Cor no carrossel: vermelho / amarelo / verde, respectivamente.
6. **Marcar item como comprado exige, antes de permitir o check:** local de compra e valor pago. Ao confirmar, grava só `comprado: true`, `localCompraId`, `valorPago`, `compradoPor`, `compradoEm` no `itensLista` — é apenas o estado "peguei no carrinho", ainda não alimenta o histórico de preços. Desmarcar limpa esses campos de compra do item normalmente. O registro em `itens/{itemId}/historicoPrecos` (local, valor, data, listaId de origem) só é criado na finalização da compra (regra 9), um por item efetivamente marcado como comprado.
7. **Comparador de preços** (aba dentro do item do catálogo): lê `historicoPrecos` do item, mas primeiro reduz a **um registro por local** (o mais recente por data, quando o mesmo item foi comprado no mesmo local mais de uma vez com valores diferentes) — é sobre esse conjunto reduzido que calcula menor/maior/média e monta a tabela local × valor × data. O histórico bruto (todas as compras) continua gravado no Firestore, só não é somado/mostrado duplicado.
8. Essa mesma regra de "só o valor mais recente por local" vale para os dashboards **Locais com preços mais baratos** e **Itens mais baratos aqui** (tela de Locais).
8.1. O usuário pode excluir, a qualquer momento, o histórico de preços de um item num local específico (aba "Histórico de Preços" do item) — a exclusão remove todos os registros daquele item+local, não só o mais recente exibido.
9. **Finalização da compra:** disponível a qualquer momento numa lista não-permanente com pelo menos 1 item (não precisa ter todos marcados). Se houver item(ns) pendente(s), o modal de finalizar avisa quantos faltam antes de confirmar, mas não bloqueia — o usuário pode finalizar mesmo assim. Ao confirmar: solicita forma de pagamento, parcelamento (se crédito) e valor total pago; para cada item **marcado como comprado** na lista, cria um registro em `itens/{itemId}/historicoPrecos` (local, valor, data, listaId de origem) — é assim que o histórico de preços por estabelecimento é alimentado. Itens que ficaram pendentes não geram registro novo e mantêm o último histórico já existente. Por fim grava `finalizadaEm` com a data e hora reais da conclusão, forma de pagamento, parcelas e valor total pago na lista (a lista não tem data prevista antes disso).
10. **Lista permanente:** uma lista com `permanente: true` nunca é "finalizada" automaticamente; o usuário vai adicionando itens ao longo do tempo e finaliza manualmente quando quiser (equivalente a uma lista contínua da semana).
11. **Compartilhamento:** ver seção 2. Convite por e-mail com ID determinístico `convites/{espacoId}_{emailNormalizado}`, aceitar/recusar, mesmo padrão usado no financeiro (índice de e-mails + get() nas rules).

## 5. Telas do app mobile

1. **Login** — e-mail/senha (mesma conta usada em qualquer outro app do usuário), esqueci minha senha.
2. **Início** — saudação ("Olá, {nome}! Vamos organizar sua próxima compra?"), dashboard (cards: valor provisionado das listas pendentes, quantidade de itens pendentes, lista mais próxima da data de compra) e gráficos (itens mais comprados, grupos mais utilizados, locais mais utilizados). FAB com speed-dial: Novo Item / Nova Lista.
3. **Listas** — carrossel de cards (título, data prevista, observação, valor provisionado, quantidade de itens, status colorido).
4. **Lista (detalhe)** — formulário de itens (adicionar do catálogo, quantidade, valor provisionado, subtotal), checkbox por item (abre modal obrigatório de local + valor antes de marcar), totais em tempo real, botão finalizar quando aplicável.
5. **Item do catálogo (detalhe)** — 3 abas: **Cadastro** (dados cadastrais), **Imagem** (foto do item — tirar/enviar/remover direto por aqui, sem precisar abrir "Editar item") e **Histórico** (tabela local/valor/data + menor/maior/média).
5.1. **Enviar item para lista pendente** — na tela de Itens (Cadastros), cada item tem um atalho para enviar direto a uma lista pendente; se houver mais de uma pendente, o app sempre pergunta qual (nunca escolhe sozinho).
6. **Cadastros** — Itens, Grupos, Locais, Formas de Pagamento, Unidades de Medida (listas simples + formulário).
7. **Listas Compartilhadas** — convidar por e-mail, ver membros do espaço, aceitar/recusar convites recebidos.
8. **Perfil** — foto, nome, sobrenome, telefone, e-mail.
9. **Configurações** — tema escuro, sair.

Menu lateral (drawer): Início, Dashboard, Listas de Compras, Cadastros (Itens, Grupos, Locais, Formas de Pagamento, Unidades de Medida), Listas Compartilhadas, Perfil, Configurações, Sair.

## 6. Fases

1. **MVP (este documento):** tudo das seções 2–5 acima.
2. **Diferenciais inteligentes:** sugestão automática de compra recorrente, alerta de aumento de preço, "melhor supermercado" para a lista atual, economia obtida vs. preço médio/mais caro, filtros inteligentes, busca rápida, duplicar lista, estatísticas mensais (gasto por grupo/supermercado, evolução do orçamento).
3. **Funcionalidades futuras:** leitura de código de barras, importação de NFC-e, lista por voz, sugestão de itens recorrentes, comparativo de preços por período, notificações de dia de compra, modo offline, busca inteligente, favoritos, categorias personalizadas.

Fases 2 e 3 ficam de fora do MVP — dependem de mais dados históricos acumulados e/ou de infraestrutura adicional (notificações push, reconhecimento de imagem/voz) fora do escopo de um app cliente-only sobre Firestore.
