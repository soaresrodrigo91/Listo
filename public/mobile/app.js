import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, serverTimestamp, writeBatch, arrayUnion, waitForPendingWrites,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Projeto Firebase PRÓPRIO deste app — nunca o mesmo projeto/banco do Controle Financeiro.
// Crie um projeto novo no Firebase Console e cole as credenciais aqui antes de publicar.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBmp0fZUinzxyfFIReRqmvfRMqqguBV6VE",
  authDomain: "listo-b0216.firebaseapp.com",
  projectId: "listo-b0216",
  messagingSenderId: "500799755224",
  appId: "1:500799755224:web:ea208627b6dfcf35ba98ad",
};

/* ---------- utilitários ---------- */
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function mesAnoAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// "YYYY-MM" de um Timestamp do Firestore, no fuso local — mesmo formato do <input type="month">.
function mesAnoDoTimestamp(timestamp) {
  if (!timestamp?.toDate) return null;
  const d = timestamp.toDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// "YYYY-MM-DD" de um Timestamp do Firestore, no fuso local — mesmo formato usado no campo "data"
// do histórico de preços.
function dataISODoTimestamp(timestamp) {
  if (!timestamp?.toDate) return null;
  const d = timestamp.toDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatarDataBR(dataISO) {
  if (!dataISO) return "—";
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}
// finalizadaEm é gravado com serverTimestamp() — vem como Firestore Timestamp, não string ISO.
function formatarDataHoraBR(timestamp) {
  if (!timestamp?.toDate) return "";
  const d = timestamp.toDate();
  const data = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const hora = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${data} às ${hora}`;
}
function formatarMoeda(valor) {
  return (valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function paraNumero(texto) {
  const limpo = String(texto ?? "").replace(/[^\d,]/g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
}
// Unidades "de peso/volume" aceitam quantidade fracionada (ex: 400,50g); as demais (Unidade,
// Caixa, Dúzia, Pacote...) são sempre contáveis em números inteiros.
const UNIDADES_FRACIONAVEIS = new Set(["grama", "gramas", "g", "kg", "quilo", "quilos", "quilograma", "quilogramas", "ml", "mililitro", "mililitros", "litro", "litros", "l"]);
// Prioriza o campo "fracionavel" cadastrado na própria unidade de medida (obrigatório para
// unidades novas); cai no heurístico por nome só pra unidades antigas, criadas antes desse campo existir.
function unidadeAceitaFracao(nomeUnidade) {
  const unidade = (unidadesAtuais || []).find((u) => u.nome === nomeUnidade);
  if (unidade && typeof unidade.fracionavel === "boolean") return unidade.fracionavel;
  return UNIDADES_FRACIONAVEIS.has((nomeUnidade || "").trim().toLowerCase());
}
// Quantidade do item na lista de compras, formatada de forma compacta pro chip clicável do meio
// da linha: unidade não fracionável mostra só o número (ex.: 1, 12, 13); fracionável mostra o
// número com vírgula colado na unidade, sem espaço (ex.: 200g, 3,5kg).
function formatarQuantidadeLista(item) {
  if (!unidadeAceitaFracao(item.unidade)) return String(item.quantidade);
  const numero = Number(item.quantidade || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return `${numero}${(item.unidade || "").toLowerCase()}`;
}
// Ajusta um campo de quantidade pra unidade atual: guarda a unidade no dataset (lido pelo
// sanitizador de digitação abaixo), troca o teclado numérico do celular e o step do spinner.
function configurarCampoQuantidade(input, nomeUnidade) {
  const fracionavel = unidadeAceitaFracao(nomeUnidade);
  input.dataset.unidade = nomeUnidade || "";
  input.step = fracionavel ? "0.01" : "1";
  input.inputMode = fracionavel ? "decimal" : "numeric";
}
// Bloqueia "." e "," digitados (ou colados) quando a unidade atual do campo não é fracionável —
// o atributo step sozinho não impede digitação de decimais, só afeta o spinner nativo.
function bloquearDecimalSeNaoFracionavel(seletor) {
  $(seletor).addEventListener("input", (e) => {
    if (unidadeAceitaFracao(e.target.dataset.unidade)) return;
    const limpo = e.target.value.replace(/[.,]/g, "");
    if (limpo !== e.target.value) e.target.value = limpo;
  });
}
// Escolha obrigatória (nunca vem pré-marcada num cadastro novo) de "sim"/"nao" pro campo
// fracionavel da unidade de medida — mesmo padrão de seleção única usado em Configurações.
const OPCOES_FRACIONAVEL_UNIDADE = [
  { valor: "nao", rotulo: "Não — quantidade sempre inteira (ex: Unidade, Caixa, Dúzia)" },
  { valor: "sim", rotulo: "Sim — aceita decimais (ex: Kg, Litro, Gramas)" },
];
function renderOpcoesFracionavelUnidade() {
  const container = $("#opcoes-fracionavel-unidade");
  container.innerHTML = OPCOES_FRACIONAVEL_UNIDADE
    .map((o) => `<div class="detalhe-linha opcao-fracionavel-unidade" data-valor="${o.valor}">
      <span class="rotulo">${esc(o.rotulo)}</span>
      <span class="radio-marca ${o.valor === fracionavelUnidadeSelecionado ? "selecionado" : ""}"></span>
    </div>`)
    .join("");
  container.querySelectorAll(".opcao-fracionavel-unidade").forEach((el) => {
    el.onclick = () => {
      fracionavelUnidadeSelecionado = el.dataset.valor;
      renderOpcoesFracionavelUnidade();
    };
  });
}
function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Usado só ao criar um cadastro novo (item, lista, grupo, local, forma de pagamento, unidade)
// pra avisar antes de gerar um duplicado — editar um cadastro já existente nunca dispara esse
// aviso, mesmo que o nome resulte igual a outro. Ignora acento/maiúscula e considera "parecido"
// quando um nome contém o outro (ex.: "Arroz" bate com "Arroz Branco") — evita virar um
// comparador difuso complexo.
function normalizarTexto(s) {
  return (s || "").trim().toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
}
// Busca de item usada em todo o app (adicionar na lista, autocomplete do cadastro, lupa da tela
// de Itens): considera nome E marca, ignora maiúscula/minúscula e acento, e acha em qualquer
// posição do texto (não só no começo da palavra).
function itemCombinaComBusca(item, termoNormalizado) {
  return normalizarTexto(item.nome).includes(termoNormalizado) || normalizarTexto(item.marca).includes(termoNormalizado);
}
function encontrarNomeParecido(nome, lista) {
  const alvo = normalizarTexto(nome);
  if (!alvo) return null;
  return lista.find((item) => {
    const existente = normalizarTexto(item.nome);
    if (!existente) return false;
    if (existente === alvo) return true;
    return alvo.length >= 3 && existente.length >= 3 && (existente.includes(alvo) || alvo.includes(existente));
  }) || null;
}
function confirmarApesarDeParecido(linhasDetalhe) {
  const detalhe = linhasDetalhe.filter(Boolean).join("\n");
  return confirm(`Já existe um cadastro com nome igual ou parecido:\n\n${detalhe}\n\nDeseja continuar e salvar mesmo assim?`);
}
// Grupo, Local, Unidade e Forma de pagamento são listas fechadas — nome igual (ignorando
// maiúscula/acento) sempre bloqueia a criação, não tem "salvar mesmo assim" (registro repetido
// não faz sentido pra esse tipo de cadastro). Nome só "parecido" (não idêntico) continua sendo um
// aviso que deixa passar — pode ser a mesma loja/grupo grafada diferente, mas também pode não ser.
// Item, ao contrário de grupo/local/unidade/forma, pode repetir o nome legitimamente (a mesma
// fruta/produto em marcas ou descrições diferentes) — só bloqueia quando o cadastro inteiro é
// idêntico a um item já existente.
function itemIdenticoAoCadastro(existente, dados) {
  const norm = (s) => normalizarTexto(s || "");
  return norm(existente.nome) === norm(dados.nome)
    && norm(existente.marca) === norm(dados.marca)
    && norm(existente.descricao) === norm(dados.descricao)
    && norm(existente.descricaoUnidade) === norm(dados.descricaoUnidade)
    && norm(existente.unidade) === norm(dados.unidade)
    && existente.grupoId === dados.grupoId
    && existente.localId === dados.localId
    && (existente.valor || 0) === (dados.valor || 0);
}
function podeSalvarComEsseNome(seletorMsg, nome, lista, linhasDetalhe) {
  const alvo = normalizarTexto(nome);
  if (lista.some((item) => normalizarTexto(item.nome) === alvo)) {
    mostrarMsg(seletorMsg, "Já existe um cadastro com esse nome.", "erro");
    return false;
  }
  const parecido = encontrarNomeParecido(nome, lista);
  if (parecido && !confirmarApesarDeParecido(linhasDetalhe(parecido))) return false;
  return true;
}
function formatarTelefone(valor) {
  const digitos = valor.replace(/\D/g, "").slice(0, 11);
  if (digitos.length === 0) return "";
  if (digitos.length <= 2) return `(${digitos}`;
  if (digitos.length <= 7) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}
function normalizarEmail(email) {
  return (email || "").trim().toLowerCase();
}
function nomeExibicaoUsuario() {
  return `${perfilAtual.nome} ${perfilAtual.sobrenome}`.trim() || usuario.email;
}
// Máscara de moeda "cifrão + centavos deslizantes": cada dígito digitado empurra os centavos,
// sempre reconstruindo a partir dos dígitos brutos (evita o cursor entrar em estados inválidos).
function aplicarMascaraMoeda(input) {
  input.addEventListener("input", (e) => {
    const digitos = e.target.value.replace(/\D/g, "");
    e.target.value = digitos ? formatarMoeda(Number(digitos) / 100) : "";
  });
  // Campo às vezes vem pré-preenchido (valor provisionado, valor do cadastro ao editar item) —
  // sem selecionar tudo ao focar, digitar por cima só empurra os centavos junto com os dígitos
  // antigos em vez de substituir, resultando num valor errado misturando os dois.
  input.addEventListener("focus", () => input.select());
}
function ligarMascaraMoeda(seletor) {
  aplicarMascaraMoeda($(seletor));
}
// Campos <input type="number"> de quantidade: o navegador já bloqueia letras, mas ainda deixa
// digitar "e"/"+"/"-" (notação científica/sinal) — bloqueia essas teclas também.
function bloquearCaracteresInvalidosNumero(seletor) {
  $(seletor).addEventListener("keydown", (e) => {
    if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
  });
}

const $ = (s) => document.querySelector(s);

/* ---------- seeds do espaço novo ---------- */
const GRUPOS_PADRAO = ["Higiene Pessoal", "Limpeza", "Verduras e Frutas", "Carnes", "Padaria", "Bebidas", "Laticínios", "Congelados", "Utilidades Domésticas", "Temperos"]
  .map((nome) => ({ nome, descricao: null }));
// "Não informado" é um local especial que sempre existe em todo espaço — é o valor padrão do
// campo obrigatório "Local" no cadastro de item, tanto pra item novo (já vem marcado) quanto pra
// item antigo que nunca teve local (migrado por garantirLocalNaoInformado/garantirLocalPadraoEmItens).
const NOME_LOCAL_NAO_INFORMADO = "Não informado";
const LOCAIS_PADRAO = ["Supermercados BH", "Villefort", "Mart Minas", "Center Pão", NOME_LOCAL_NAO_INFORMADO]
  .map((nome) => ({ nome, endereco: null, cidade: null }));
const FORMAS_PADRAO = ["PIX", "Dinheiro", "Cartão de Débito", "Cartão de Crédito", "Flash"]
  .map((nome) => ({ nome }));
// Abrevia as unidades padrão com forma curta conhecida (usado no "R$/un." da lista de compras);
// unidade fora dessa lista (inclusive as que a pessoa cadastrar) usa o próprio nome, minúsculo —
// as demais do seed (Bandeja, Fardo, Frasco, Garrafa, Lata, Rolo, Saco) não têm abreviação
// consagrada em português, então ficam por extenso mesmo.
const ABREVIACOES_UNIDADE = { kg: "kg", gramas: "g", ml: "ml", unidade: "un.", caixa: "cx", dúzia: "dz" };
const UNIDADES_PADRAO = [
  { nome: "Bandeja", fracionavel: false, abreviacao: null }, { nome: "Caixa", fracionavel: false, abreviacao: "cx" },
  { nome: "Dúzia", fracionavel: false, abreviacao: "dz" }, { nome: "Fardo", fracionavel: false, abreviacao: null },
  { nome: "Frasco", fracionavel: false, abreviacao: null }, { nome: "Garrafa", fracionavel: false, abreviacao: null },
  { nome: "Gramas", fracionavel: true, abreviacao: "g" }, { nome: "Kg", fracionavel: true, abreviacao: "kg" },
  { nome: "Lata", fracionavel: false, abreviacao: null }, { nome: "ml", fracionavel: true, abreviacao: "ml" },
  { nome: "Rolo", fracionavel: false, abreviacao: null }, { nome: "Saco", fracionavel: false, abreviacao: null },
  { nome: "Unidade", fracionavel: false, abreviacao: "un." },
];
function abreviarUnidade(nomeUnidade) {
  // Prioriza a abreviação salva no cadastro da própria unidade; sem uma, cai na tabela padrão
  // (unidades do seed); sem estar nem lá, usa o nome como está, em minúsculo.
  const unidade = (unidadesAtuais || []).find((u) => u.nome === nomeUnidade);
  if (unidade?.abreviacao) return unidade.abreviacao;
  const chave = (nomeUnidade || "").trim().toLowerCase();
  return ABREVIACOES_UNIDADE[chave] || chave || "un";
}
// Preenche em segundo plano a abreviação das unidades padrão criadas antes desse campo existir
// (silencioso, sem botão) — unidade nova que a pessoa cadastrar continua exigindo que ela mesma
// informe a abreviação, já que não tem como adivinhar uma unidade inventada.
let abreviacoesPadraoAplicadas = false;
async function aplicarAbreviacoesPadraoUnidades() {
  if (abreviacoesPadraoAplicadas) return;
  abreviacoesPadraoAplicadas = true;
  const pendentes = unidadesAtuais.filter((u) => !u.abreviacao && ABREVIACOES_UNIDADE[u.nome.trim().toLowerCase()]);
  await Promise.all(pendentes.map((u) => updateDoc(
    doc(bd, "espacos", espacoIdAtual, "unidadesMedida", u.id),
    { abreviacao: ABREVIACOES_UNIDADE[u.nome.trim().toLowerCase()] }
  )));
}
const ICONE_CALENDARIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" style="vertical-align:-1px;margin-right:3px"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v3.2M16 3v3.2"/></svg>';
const ICONE_SITE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9Z"/></svg>';
const ICONE_PESSOA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="11" height="11" style="vertical-align:-1px;margin-right:3px"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/></svg>';
const ICONE_LOCAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="11" height="11" style="vertical-align:-1px;margin-right:3px"><path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
// SVG em vez de emoji: emoji tem cor própria e ignora a cor de fundo do botão (fica sempre com
// as mesmas cores do sistema), enquanto o SVG com stroke="currentColor" acompanha o azul do fab.
const ICONE_LUPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
const ICONE_FECHAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';
// Duas setas em círculo (trocar/substituir) — usado no botão discreto de trocar item da lista.
const ICONE_TROCAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

/* ---------- estado ---------- */
let auth = null, bd = null, usuario = null;
let espacoIdAtual = null;
// createUserWithEmailAndPassword dispara onAuthStateChanged antes mesmo de criarConta()
// continuar — guarda os dados do formulário aqui para os dois lados da corrida (o listener
// e o await explícito de criarConta) usarem o mesmo nome/sobrenome/telefone, não importa
// qual dos dois "ganha" e efetivamente cria o usuário/espaço.
let dadosCadastroPendente = null;
let perfilAtual = { nome: "", sobrenome: "", telefone: "", fotoUrl: null, email: "" };
let espacoAtual = { membros: [], membrosInfo: {} };
let gruposAtuais = [], locaisAtuais = [], formasAtuais = [], unidadesAtuais = [], itensAtuais = [], listasAtuais = [];
let itensListaAtuais = [];
let historicoAtual = [];
let convitesAtuais = [];
let notificacoesAtuais = [];
let listaAbertaId = null;
// Guarda de qual lista veio o atalho "+ Cadastrar" (busca de item sem resultado, dentro de uma
// lista) — só setado por esse fluxo específico, pra saber depois de salvar o cadastro se deve
// oferecer pra adicionar o item recém-criado direto nessa lista.
let listaOrigemNovoItem = null;
let itemCatalogoAbertoId = null;
let itemListaPendenteId = null;
// Item da lista sendo substituído no modal "Trocar item" (aberto pelo botão discreto embaixo do
// checkbox de cada item pendente).
let itemListaTrocaId = null;
// Guarda de qual item da lista veio o atalho "+ Cadastrar" dentro do modal de troca (busca sem
// resultado) — só setado por esse fluxo específico, pra saber depois de salvar o cadastro se deve
// oferecer pra trocar o item recém-criado no lugar da linha original (equivalente a
// listaOrigemNovoItem, mas para o fluxo de troca em vez do fluxo de adicionar).
let itemListaTrocaPendenteAoCadastrar = null;
// Último valor considerado (cadastro/último comprado/mais barato) pro item aberto no modal de
// comprar — usado só pra comparar ao vivo com o que a pessoa digita em "Valor pago".
let valorReferenciaModalComprar = 0;
let ultimoLocalUsadoId = null;
let localMaisUsadoId = null;
let telaAnterior = "inicio";
let filtroGrupoLista = null, filtroGrupoItens = null;
// Ordenação dos itens de uma lista já finalizada — só existe pra listas finalizadas (nome ou
// valor, cada uma com sua própria direção); enquanto pendente, os itens seguem a ordem padrão
// (pendentes primeiro, depois alfabética) e esse estado fica ignorado.
let ordenacaoListaFinalizada = null, direcaoOrdenacaoListaFinalizada = "asc";
let fracionavelUnidadeSelecionado = null;
const termoBuscaCadastro = { itens: "", grupos: "", locais: "", formas: "", unidades: "" };

let unsubUsuario = null, unsubEspacoDoc = null, unsubGrupos = null, unsubLocais = null,
  unsubFormas = null, unsubUnidades = null, unsubItens = null, unsubListas = null, unsubItensLista = null, unsubConvites = null,
  unsubNotificacoes = null;

/* ---------- inicialização ---------- */
window.addEventListener("DOMContentLoaded", () => {
  ligarEventos();

  const avisoPosAtualizacao = sessionStorage.getItem("avisoPosAtualizacao");
  if (avisoPosAtualizacao) {
    sessionStorage.removeItem("avisoPosAtualizacao");
    exibirSucesso(avisoPosAtualizacao, 3000);
  }

  // Sem credenciais do Firebase ainda (FIREBASE_CONFIG vazio): mostra a tela de login para
  // conferência visual do layout, mas sem tentar autenticar de verdade.
  if (!FIREBASE_CONFIG.apiKey) {
    $("#carregando").classList.add("hidden");
    $("#tela-login").classList.remove("hidden");
    mostrarMsg("#msg-login", "Configure o FIREBASE_CONFIG em app.js para habilitar o login.", "erro");
    return;
  }

  const app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  bd = getFirestore(app);

  onAuthStateChanged(auth, async (u) => {
    if (u) {
      usuario = u;
      await garantirUsuarioEEspaco(u, dadosCadastroPendente?.nome, dadosCadastroPendente?.sobrenome, dadosCadastroPendente?.telefone);
      assinarUsuarioEEspaco(u.uid);
      assinarConvitesRecebidos();
      assinarNotificacoes();
      avisarSeNovaVersaoDisponivel();
      $("#carregando").classList.add("hidden");
      $("#tela-login").classList.add("hidden");
      $("#tela-cadastro").classList.add("hidden");
      $("#app").classList.remove("hidden");
      irParaTela("inicio");
      // Só agora o #app deixa de ter display:none — criar o observer antes disso faz o root
      // (main) ter tamanho zero e o efeito de sumir a saudação ao rolar nunca dispara.
      observarSaudacao();
      abrirOnboardingSeNecessario();
    } else {
      usuario = null;
      espacoIdAtual = null;
      [unsubUsuario, unsubEspacoDoc, unsubGrupos, unsubLocais, unsubFormas, unsubUnidades, unsubItens, unsubListas, unsubItensLista, unsubConvites, unsubNotificacoes]
        .forEach((u2) => u2 && u2());
      $("#carregando").classList.add("hidden");
      $("#app").classList.add("hidden");
      $("#tela-cadastro").classList.add("hidden");
      $("#tela-login").classList.remove("hidden");
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/mobile/sw.js").catch(() => {});
  }

  // Reabrir o app depois de um tempo em segundo plano é o momento mais comum de estar
  // rodando uma versão desatualizada (o PWA fica suspenso na memória sem recarregar sozinho).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") avisarSeNovaVersaoDisponivel();
  });
  setInterval(avisarSeNovaVersaoDisponivel, 30 * 60 * 1000);
});

/* ---------- login / cadastro ---------- */
function mostrarMsg(seletor, texto, tipo) {
  const el = $(seletor);
  el.textContent = texto;
  el.className = texto ? `aviso ${tipo || ""}` : "";
}

let timeoutToastSucesso = null;
function exibirSucesso(texto, duracaoMs) {
  $("#toast-sucesso-texto").textContent = texto;
  $("#toast-sucesso").classList.remove("hidden");
  clearTimeout(timeoutToastSucesso);
  timeoutToastSucesso = setTimeout(() => {
    $("#toast-sucesso").classList.add("hidden");
  }, duracaoMs || 2000);
}

async function entrar() {
  const email = $("#login-email").value.trim();
  const senha = $("#login-senha").value;
  if (!email || !senha) {
    mostrarMsg("#msg-login", "Preencha e-mail e senha.", "erro");
    return;
  }
  $("#btn-entrar").disabled = true;
  $("#btn-entrar").textContent = "Aguarde...";
  try {
    await signInWithEmailAndPassword(auth, email, senha);
    mostrarMsg("#msg-login", "", "");
  } catch (e) {
    const mapa = {
      "auth/invalid-credential": "E-mail não cadastrado ou senha incorreta.",
      "auth/user-not-found": "Este e-mail não está cadastrado.",
      "auth/wrong-password": "Senha incorreta.",
      "auth/invalid-email": "E-mail inválido.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo.",
    };
    mostrarMsg("#msg-login", mapa[e.code] || `Erro: ${e.code}`, "erro");
  }
  $("#btn-entrar").disabled = false;
  $("#btn-entrar").textContent = "Entrar";
}

async function esqueciSenha() {
  const email = $("#login-email").value.trim();
  if (!email) {
    mostrarMsg("#msg-login", "Digite seu e-mail no campo acima primeiro.", "erro");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    mostrarMsg("#msg-login", "Enviamos um link de redefinição para seu e-mail.", "ok");
  } catch {
    mostrarMsg("#msg-login", "Não foi possível enviar. Confira o e-mail digitado.", "erro");
  }
}

async function criarConta() {
  const nome = $("#cad-nome").value.trim();
  const sobrenome = $("#cad-sobrenome").value.trim();
  const telefone = $("#cad-telefone").value.trim();
  const email = $("#cad-email").value.trim();
  const senha = $("#cad-senha").value;
  if (!nome || !email || senha.length < 6) {
    mostrarMsg("#msg-cadastro", "Preencha nome, e-mail e uma senha com pelo menos 6 caracteres.", "erro");
    return;
  }
  $("#btn-criar-conta").disabled = true;
  $("#btn-criar-conta").textContent = "Criando conta...";
  dadosCadastroPendente = { nome, sobrenome, telefone };
  try {
    const credencial = await createUserWithEmailAndPassword(auth, email, senha);
    await updateProfile(credencial.user, { displayName: `${nome} ${sobrenome}`.trim() });
    await garantirUsuarioEEspaco(credencial.user, nome, sobrenome, telefone);
  } catch (e) {
    const mapa = {
      "auth/email-already-in-use": "Já existe uma conta com este e-mail.",
      "auth/invalid-email": "E-mail inválido.",
      "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    };
    mostrarMsg("#msg-cadastro", mapa[e.code] || `Erro: ${e.code}`, "erro");
    $("#btn-criar-conta").disabled = false;
    $("#btn-criar-conta").textContent = "Criar conta";
  } finally {
    dadosCadastroPendente = null;
  }
}

/* ---------- usuário + espaço compartilhado ---------- */
// Evita que a chamada explícita do cadastro (criarConta) e a chamada automática do
// onAuthStateChanged (disparada pelo próprio createUserWithEmailAndPassword) rodem em
// paralelo e cheguem juntas no getDoc abaixo antes de qualquer uma escrever — a segunda
// chamada concorrente simplesmente aguarda a mesma promessa em vez de duplicar o trabalho.
let promessaGarantirUsuario = null;

async function garantirUsuarioEEspaco(user, nomeCadastro, sobrenomeCadastro, telefoneCadastro) {
  if (promessaGarantirUsuario) return promessaGarantirUsuario;
  promessaGarantirUsuario = (async () => {
    const refUsuario = doc(bd, "usuarios", user.uid);
    const snap = await getDoc(refUsuario);
    if (snap.exists()) {
      espacoIdAtual = snap.data().espacoId;
      return;
    }

    const nome = nomeCadastro ?? (user.displayName || "");
    const email = normalizarEmail(user.email || "");
    const refEspaco = await addDoc(collection(bd, "espacos"), {
      criadoPor: user.uid,
      criadoEm: serverTimestamp(),
      membros: [user.uid],
      membrosInfo: { [user.uid]: { nome, email } },
    });

    await Promise.all([
      setDoc(refUsuario, {
        nome, sobrenome: sobrenomeCadastro ?? "", telefone: telefoneCadastro ?? "", fotoUrl: null, email,
        espacoId: refEspaco.id, criadoEm: serverTimestamp(),
      }),
      setDoc(doc(bd, "indiceEmails", email), { uid: user.uid }),
      ...GRUPOS_PADRAO.map((g) => addDoc(collection(bd, "espacos", refEspaco.id, "grupos"), g)),
      ...LOCAIS_PADRAO.map((l) => addDoc(collection(bd, "espacos", refEspaco.id, "locais"), l)),
      ...FORMAS_PADRAO.map((f) => addDoc(collection(bd, "espacos", refEspaco.id, "formasPagamento"), f)),
      ...UNIDADES_PADRAO.map((u) => addDoc(collection(bd, "espacos", refEspaco.id, "unidadesMedida"), u)),
    ]);
    espacoIdAtual = refEspaco.id;
  })();
  try {
    await promessaGarantirUsuario;
  } finally {
    promessaGarantirUsuario = null;
  }
}

// Rede de segurança: se por qualquer motivo o espaço do próprio criador ficar sem
// grupos/locais/formas (ex.: falha de rede no meio do cadastro), semeia os padrões
// assim que detectar as coleções vazias — garante que todo usuário que se cadastrar
// sempre acabe com os cadastros padrão, mesmo que o seeding original tenha falhado.
// Guard de single-flight por espaço: reconectarEspaco pode ser chamado de novo (ex.: o
// próprio usuarios/{uid} mudando por outro motivo) antes da primeira checagem terminar —
// sem isso, duas chamadas concorrentes podem ver a coleção vazia ao mesmo tempo e ambas
// inserirem os padrões, duplicando tudo.
const espacosSemeandoEmAndamento = new Set();
async function garantirCatalogoSemeado(espacoId) {
  if (espacosSemeandoEmAndamento.has(espacoId)) return;
  espacosSemeandoEmAndamento.add(espacoId);
  try {
    const espacoSnap = await getDoc(doc(bd, "espacos", espacoId));
    if (!espacoSnap.exists() || espacoSnap.data().criadoPor !== usuario?.uid) return;

    // allSettled (não all): se uma coleção falhar (ex.: regra nova ainda não publicada no
    // Firebase Console), as outras ainda são checadas/semeadas normalmente — uma não trava as demais.
    const colecoes = [
      ["grupos", GRUPOS_PADRAO],
      ["locais", LOCAIS_PADRAO],
      ["formasPagamento", FORMAS_PADRAO],
      ["unidadesMedida", UNIDADES_PADRAO],
    ];
    const resultados = await Promise.allSettled(
      colecoes.map(([nome]) => getDocs(collection(bd, "espacos", espacoId, nome)))
    );
    await Promise.allSettled(
      resultados.map((r, i) => {
        if (r.status !== "fulfilled" || !r.value.empty) return null;
        const [nome, padrao] = colecoes[i];
        return Promise.all(padrao.map((doc_) => addDoc(collection(bd, "espacos", espacoId, nome), doc_)));
      })
    );

    // Antes de tudo, funde locais que ficaram com o mesmo nome (ex.: duas sessões criando "Não
    // informado" ao mesmo tempo numa corrida) — sem isso, garantirLocalNaoInformado abaixo poderia
    // escolher um dos dois arbitrariamente e deixar o outro órfão pra sempre.
    await mesclarLocaisDuplicados(espacoId);

    // "Não informado" precisa existir em TODO espaço, não só nos novos — espaços criados antes
    // do campo "Local" existir no cadastro de item já têm a coleção "locais" não-vazia, então o
    // seeding padrão acima (que só roda com a coleção vazia) nunca chegaria a criar esse local
    // neles. Depois de garantir que ele existe, aproveita e migra os itens antigos que ainda não
    // têm local (ver garantirLocalPadraoEmItens).
    const naoInformadoId = await garantirLocalNaoInformado(espacoId);
    if (naoInformadoId) await garantirLocalPadraoEmItens(espacoId, naoInformadoId);
  } catch (e) {
    console.error("garantirCatalogoSemeado falhou:", e);
  } finally {
    espacosSemeandoEmAndamento.delete(espacoId);
  }
}
// Funde locais com o mesmo nome (ignorando maiúscula/acento) num só — mantém o mais antigo (menor
// id de criação não dá pra saber, então usa ordem alfabética do id do documento como critério
// estável) e reaponta pra ele tanto o cadastro do item (localId) quanto o histórico de preços de
// cada item antes de apagar os duplicados, senão a referência ficaria quebrada.
async function mesclarLocaisDuplicados(espacoId) {
  const snapLocais = await getDocs(collection(bd, "espacos", espacoId, "locais"));
  const porNome = new Map();
  for (const d of snapLocais.docs) {
    const chave = normalizarTexto(d.data().nome);
    if (!porNome.has(chave)) porNome.set(chave, []);
    porNome.get(chave).push(d);
  }
  const grupos = [...porNome.values()].filter((docs) => docs.length > 1);
  if (!grupos.length) return;
  const snapItens = await getDocs(collection(bd, "espacos", espacoId, "itens"));
  for (const docs of grupos) {
    docs.sort((a, b) => a.id.localeCompare(b.id));
    const [canonico, ...duplicados] = docs;
    for (const dup of duplicados) {
      for (const it of snapItens.docs) {
        if (it.data().localId === dup.id) {
          await updateDoc(doc(bd, "espacos", espacoId, "itens", it.id), { localId: canonico.id, localNome: canonico.data().nome });
        }
        const snapHist = await getDocs(query(collection(bd, "espacos", espacoId, "itens", it.id, "historicoPrecos"), where("localId", "==", dup.id)));
        await Promise.allSettled(snapHist.docs.map((h) =>
          updateDoc(doc(bd, "espacos", espacoId, "itens", it.id, "historicoPrecos", h.id), { localId: canonico.id })
        ));
      }
      await deleteDoc(doc(bd, "espacos", espacoId, "locais", dup.id));
    }
  }
}
async function garantirLocalNaoInformado(espacoId) {
  // Comparação ignora maiúscula/acento: alguns espaços já podem ter um local equivalente
  // cadastrado manualmente (ex.: "Não Informado") antes desse campo virar automático — usar esse
  // já existente evita duplicar.
  const snap = await getDocs(collection(bd, "espacos", espacoId, "locais"));
  const existente = snap.docs.find((d) => normalizarTexto(d.data().nome) === normalizarTexto(NOME_LOCAL_NAO_INFORMADO));
  if (existente) return existente.id;
  const ref = await addDoc(collection(bd, "espacos", espacoId, "locais"), { nome: NOME_LOCAL_NAO_INFORMADO, endereco: null, cidade: null });
  return ref.id;
}
// Item cadastrado antes do campo "Local" existir não tem localId — assume "Não informado" pra
// não deixar o cadastro incompleto, sem mexer em mais nada (a semente de historicoPrecos
// continua com origemCadastro:true, só ganha o localId que faltava).
async function garantirLocalPadraoEmItens(espacoId, naoInformadoId) {
  const snapItens = await getDocs(collection(bd, "espacos", espacoId, "itens"));
  const itensSemLocal = snapItens.docs.filter((d) => !d.data().localId);
  await Promise.allSettled(itensSemLocal.map(async (d) => {
    await updateDoc(doc(bd, "espacos", espacoId, "itens", d.id), { localId: naoInformadoId, localNome: NOME_LOCAL_NAO_INFORMADO });
    const snapHist = await getDocs(collection(bd, "espacos", espacoId, "itens", d.id, "historicoPrecos"));
    const semente = snapHist.docs.find((h) => h.data().origemCadastro && !h.data().localId);
    if (semente) await updateDoc(doc(bd, "espacos", espacoId, "itens", d.id, "historicoPrecos", semente.id), { localId: naoInformadoId });
  }));
}

function assinarUsuarioEEspaco(uid) {
  if (unsubUsuario) unsubUsuario();
  unsubUsuario = onSnapshot(doc(bd, "usuarios", uid), (snap) => {
    const d = snap.data();
    if (!d) return;
    perfilAtual = { nome: d.nome || "", sobrenome: d.sobrenome || "", telefone: d.telefone || "", fotoUrl: d.fotoUrl || null, email: d.email || "" };
    atualizarAvatarTopbar();
    atualizarSaudacao();
    if (!$("#tela-perfil").classList.contains("hidden")) preencherFormPerfil();
    if (d.espacoId && d.espacoId !== espacoIdAtual) {
      espacoIdAtual = d.espacoId;
      reconectarEspaco(espacoIdAtual);
    } else if (d.espacoId && !unsubEspacoDoc) {
      reconectarEspaco(espacoIdAtual);
    }
  });
}

function reconectarEspaco(espacoId) {
  [unsubEspacoDoc, unsubGrupos, unsubLocais, unsubFormas, unsubUnidades, unsubItens, unsubListas].forEach((u) => u && u());
  garantirCatalogoSemeado(espacoId);
  abreviacoesPadraoAplicadas = false;

  unsubEspacoDoc = onSnapshot(doc(bd, "espacos", espacoId), (snap) => {
    espacoAtual = snap.data() || { membros: [], membrosInfo: {} };
    renderMembros();
  });

  unsubGrupos = onSnapshot(collection(bd, "espacos", espacoId, "grupos"), (snap) => {
    gruposAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    renderCadastroGrupos();
    renderChipsFiltroGrupo();
  });
  unsubLocais = onSnapshot(collection(bd, "espacos", espacoId, "locais"), (snap) => {
    locaisAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    preencherSelectsDeLocal();
    renderCadastroLocais();
    renderChipsFiltroLocal();
    renderDashboard();
  });
  unsubFormas = onSnapshot(collection(bd, "espacos", espacoId, "formasPagamento"), (snap) => {
    formasAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    preencherSelectFormaPagamento();
    renderCadastroFormas();
  });
  unsubUnidades = onSnapshot(collection(bd, "espacos", espacoId, "unidadesMedida"), (snap) => {
    unidadesAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    renderCadastroUnidades();
    aplicarAbreviacoesPadraoUnidades();
  });
  unsubItens = onSnapshot(collection(bd, "espacos", espacoId, "itens"), (snap) => {
    itensAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    renderCadastroItens();
    renderDashboard();
  });
  unsubListas = onSnapshot(collection(bd, "espacos", espacoId, "listas"), (snap) => {
    listasAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCarrosselListas();
    renderDashboard();
    // Mantém o cabeçalho (total, status) da lista aberta em dia quando o próprio doc da lista muda
    // (ex: recalcularTotaisLista após alterar quantidade), sem depender de reabrir a tela.
    if (listaAbertaId) renderListaDetalhe();
  });
}

/* ---------- perfil ---------- */
function iniciaisPerfil() {
  const iniciais = (perfilAtual.nome.trim().charAt(0) + perfilAtual.sobrenome.trim().charAt(0)).toUpperCase();
  if (iniciais.trim()) return iniciais;
  if (usuario?.email) return usuario.email[0].toUpperCase();
  return "U";
}
function atualizarAvatarTopbar() {
  const el = $("#topbar-avatar");
  el.innerHTML = perfilAtual.fotoUrl ? `<img src="${perfilAtual.fotoUrl}" alt="Foto de perfil">` : iniciaisPerfil();
}
function atualizarSaudacao() {
  $("#saudacao-nome").textContent = perfilAtual.nome ? `Olá, ${esc(perfilAtual.nome)}!` : "Olá!";
}
function preencherFormPerfil() {
  $("#pf-nome").value = perfilAtual.nome;
  $("#pf-sobrenome").value = perfilAtual.sobrenome;
  $("#pf-telefone").value = perfilAtual.telefone;
  $("#pf-email").value = perfilAtual.email;
  $("#pf-avatar").innerHTML = perfilAtual.fotoUrl ? `<img src="${perfilAtual.fotoUrl}" alt="Foto de perfil">` : iniciaisPerfil();
  mostrarMsg("#msg-perfil", "", "");
}
async function salvarPerfil() {
  const nome = $("#pf-nome").value.trim();
  const sobrenome = $("#pf-sobrenome").value.trim();
  const telefone = $("#pf-telefone").value.trim();
  $("#btn-salvar-perfil").disabled = true;
  try {
    await updateDoc(doc(bd, "usuarios", usuario.uid), { nome, sobrenome, telefone });
    exibirSucesso("Perfil salvo com sucesso!");
  } catch {
    mostrarMsg("#msg-perfil", "Não foi possível salvar. Tente novamente.", "erro");
  }
  $("#btn-salvar-perfil").disabled = false;
}

/* ---------- segurança (trocar senha) ---------- */
async function alterarSenha() {
  const senhaAtual = $("#sg-senha-atual").value;
  const novaSenha = $("#sg-senha-nova").value;
  const confirmar = $("#sg-senha-confirmar").value;
  if (!senhaAtual || novaSenha.length < 6) {
    mostrarMsg("#msg-seguranca", "Preencha a senha atual e uma nova senha com pelo menos 6 caracteres.", "erro");
    return;
  }
  if (novaSenha !== confirmar) {
    mostrarMsg("#msg-seguranca", "A confirmação não é igual à nova senha.", "erro");
    return;
  }
  $("#btn-salvar-seguranca").disabled = true;
  try {
    const credencial = EmailAuthProvider.credential(usuario.email, senhaAtual);
    await reauthenticateWithCredential(usuario, credencial);
    await updatePassword(usuario, novaSenha);
    $("#sg-senha-atual").value = "";
    $("#sg-senha-nova").value = "";
    $("#sg-senha-confirmar").value = "";
    mostrarMsg("#msg-seguranca", "", "");
    exibirSucesso("Senha alterada com sucesso!");
  } catch (e) {
    const mapa = {
      "auth/wrong-password": "Senha atual incorreta.",
      "auth/invalid-credential": "Senha atual incorreta.",
      "auth/weak-password": "A nova senha precisa ter pelo menos 6 caracteres.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo.",
      "auth/requires-recent-login": "Por segurança, saia e entre novamente antes de trocar a senha.",
    };
    mostrarMsg("#msg-seguranca", mapa[e.code] || `Erro: ${e.code}`, "erro");
  }
  $("#btn-salvar-seguranca").disabled = false;
}
// Sem Firebase Storage no projeto — fotos são redimensionadas no navegador e guardadas
// como data URL (base64) direto no documento do Firestore, igual à foto de perfil.
async function redimensionarImagem(arquivo, tamanhoMax, qualidade) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, tamanhoMax / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, largura, altura);
  return canvas.toDataURL("image/jpeg", qualidade || 0.8);
}
async function salvarFotoPerfil(arquivo) {
  const texto = $("#pf-label-foto-texto");
  texto.textContent = "Enviando...";
  try {
    const dataUrl = await redimensionarImagem(arquivo, 256);
    await updateDoc(doc(bd, "usuarios", usuario.uid), { fotoUrl: dataUrl });
  } catch {
    mostrarMsg("#msg-perfil", "Não foi possível enviar a foto. Tente novamente.", "erro");
  }
  texto.textContent = "Alterar foto";
}

/* ---------- selects auxiliares ---------- */
function preencherSelectsDeLocal() {
  const opcoes = locaisAtuais.map((l) => `<option value="${l.id}">${esc(l.nome)}</option>`).join("");
  $("#mc-local").innerHTML = opcoes;
}
function preencherSelectFormaPagamento() {
  // A tela de finalizar renderiza o <select> de cada forma de pagamento dinamicamente
  // (renderPagamentosFinalizar), direto a partir de formasAtuais — só precisa atualizar as
  // linhas já desenhadas se o modal estiver aberto no momento em que a lista de formas mudar.
  if (!$("#overlay-finalizar").classList.contains("hidden")) {
    renderPagamentosFinalizar();
  }
}
// Nenhuma sugestão aparece até o usuário digitar — nada vem pré-selecionado, diferente de um
// <select> nativo (que sempre mostra/seleciona a primeira opção por padrão).
// Token evita que a resposta de uma busca antiga (mais lenta) sobrescreva uma mais nova —
// a consulta do valor provisionado é assíncrona (histórico de preços), então pode chegar fora
// de ordem se a pessoa digitar rápido.
let tokenSugestoesItemLista = 0;
// Valor por unidade do item selecionado no formulário de adicionar item na lista — junto com a
// quantidade, dá o valor provisionado mostrado no campo "Valor" (recalculado a cada mudança).
let valorUnitarioAdicionarItem = 0;
function atualizarValorAdicionarItem() {
  const quantidade = Number($("#ld-quantidade").value) || 0;
  $("#ld-valor-provisionado").value = formatarMoeda(valorUnitarioAdicionarItem * quantidade);
}
async function renderSugestoesItemLista(query) {
  const container = $("#ld-item-sugestoes");
  const termo = normalizarTexto(query);
  const encontrados = termo.length < 1 ? [] : itensAtuais.filter((i) => itemCombinaComBusca(i, termo)).slice(0, 6);
  // Invalida qualquer busca assíncrona anterior (valores dos itens encontrados) já na entrada da
  // função, não só quando ESTA chamada encontra itens — senão uma resposta lenta de uma busca
  // antiga (que tinha achado algo) pode chegar depois e sobrescrever o "não encontrado" mais
  // recente com uma lista de itens já obsoleta, escondendo o atalho de cadastro.
  const meuToken = ++tokenSugestoesItemLista;

  if (termo.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  // Digitou algo e não achou nada no catálogo: atalho pra cadastrar o item na hora, em vez de
  // ter que desistir da lista, ir em Cadastros > Itens e voltar depois.
  if (encontrados.length === 0) {
    container.innerHTML = `<div class="autocomplete-item autocomplete-novo-item" id="ld-cadastrar-novo-item"><span class="nome">Item não encontrado</span><span class="valor">+ Cadastrar "${esc(query.trim())}"</span></div>`;
    container.classList.remove("hidden");
    $("#ld-cadastrar-novo-item").onclick = () => {
      container.classList.add("hidden");
      container.innerHTML = "";
      abrirFormNovoItem();
      $("#fi-nome").value = query.trim();
      // Veio do atalho dentro da lista — ao salvar (ou cancelar), volta pra essa lista em vez de
      // ir pra tela de cadastro de itens.
      telaAnterior = "lista-detalhe";
      listaOrigemNovoItem = listaAbertaId;
    };
    return;
  }
  // Mesma regra de preferência (Configurações) usada ao adicionar o item de fato: valor do
  // cadastro, último comprado ou mais barato — sem histórico ainda, cai no valor do cadastro.
  // Uma falha de rede aqui não pode travar a seleção do item: sem valor, mostra R$ 0,00 mas
  // ainda deixa clicar e adicionar normalmente.
  let valores;
  try {
    valores = await Promise.all(encontrados.map((i) => valorProvisionadoParaItem(i)));
  } catch {
    valores = encontrados.map(() => 0);
  }
  if (meuToken !== tokenSugestoesItemLista) return;
  container.innerHTML = encontrados
    .map((i, idx) => {
      const detalhe = [i.marca, i.descricao, i.descricaoUnidade].filter(Boolean).join(" · ");
      return `<div class="autocomplete-item" data-id="${i.id}"><span class="nome">${esc(i.nome)}</span><span class="grupo">${esc(detalhe)}</span><span class="valor">${formatarMoeda(valores[idx])}</span></div>`;
    })
    .join("");
  container.classList.remove("hidden");
  container.querySelectorAll(".autocomplete-item").forEach((el) => {
    el.onclick = () => {
      const item = itensAtuais.find((i) => i.id === el.dataset.id);
      if (!item) return;
      $("#ld-item-nome").value = item.nome;
      $("#ld-item-id").value = item.id;
      $("#ld-unidade").value = item.unidade || "";
      configurarCampoQuantidade($("#ld-quantidade"), item.unidade);
      valorUnitarioAdicionarItem = valores[encontrados.indexOf(item)];
      atualizarValorAdicionarItem();
      container.classList.add("hidden");
      container.innerHTML = "";
    };
  });
}

/* ---------- dashboard (Início) ---------- */
// Preferência (Configurações) de período dos rankings da Início (Grupos/Itens/Locais mais
// utilizados) — "Valor provisionado" e "Lista (Pendente)" não entram aqui, são sobre listas ainda
// PENDENTES, não sobre compras finalizadas, então o período não se aplica a eles.
const OPCOES_PERIODO_DASHBOARD = [
  { valor: "mes", rotulo: "Somente o mês atual" },
  { valor: "todas", rotulo: "Todas as compras finalizadas" },
];
function preferenciaPeriodoDashboard() {
  try { return localStorage.getItem("prefPeriodoDashboard") || "mes"; } catch { return "mes"; }
}
function renderOpcoesPeriodoDashboard() {
  const atual = preferenciaPeriodoDashboard();
  const container = $("#opcoes-periodo-dashboard");
  container.innerHTML = OPCOES_PERIODO_DASHBOARD
    .map((o) => `<div class="detalhe-linha opcao-periodo-dashboard" data-valor="${o.valor}">
      <span class="rotulo">${esc(o.rotulo)}</span>
      <span class="radio-marca ${o.valor === atual ? "selecionado" : ""}"></span>
    </div>`)
    .join("");
  container.querySelectorAll(".opcao-periodo-dashboard").forEach((el) => {
    el.onclick = () => {
      try { localStorage.setItem("prefPeriodoDashboard", el.dataset.valor); } catch {}
      renderOpcoesPeriodoDashboard();
      renderDashboard();
    };
  });
}
// "Olhinho" de privacidade dos dashboards (Grupos/Itens/Locais mais utilizados): variável comum
// (não localStorage) de propósito — sempre começa fechado (nomes ocultos) a cada carregamento do
// app, mas continua aberto ao navegar entre telas e voltar pra Início dentro da mesma sessão, já
// que só é reatribuída aqui.
let dashboardNomesVisiveis = false;
function alternarPrivacidadeDashboard() {
  dashboardNomesVisiveis = !dashboardNomesVisiveis;
  atualizarBotaoPrivacidadeDashboard();
}
function atualizarBotaoPrivacidadeDashboard() {
  $("#tela-inicio main").classList.toggle("oculta-nomes-dashboard", !dashboardNomesVisiveis);
  const btn = $("#btn-toggle-nomes-dashboard");
  btn.setAttribute("aria-pressed", String(dashboardNomesVisiveis));
  btn.setAttribute("aria-label", dashboardNomesVisiveis ? "Ocultar nomes nos dashboards" : "Mostrar nomes nos dashboards");
  btn.querySelector(".icone-olho-aberto").classList.toggle("hidden", !dashboardNomesVisiveis);
  btn.querySelector(".icone-olho-fechado").classList.toggle("hidden", dashboardNomesVisiveis);
}
// Descarta qualquer render em andamento assim que outro começa — necessário porque o cálculo
// "mês atual" é assíncrono (busca itensLista de cada lista finalizada do mês) e renderDashboard
// dispara toda hora (a cada mudança em listasAtuais/itensAtuais); sem isso, uma resposta lenta de
// um render antigo podia sobrescrever a tela por cima de um resultado mais novo.
let dashboardRenderToken = 0;
function renderDashboard() {
  // "Pendente" aqui é "ainda não finalizada" (finalizadaEm), não "status comprada" — uma lista
  // com todos os itens já marcados, mas ainda sem finalizar, continua editável normalmente.
  const pendentes = listasAtuais.filter((l) => !l.finalizadaEm);
  // "Valor provisionado" e "Itens pendentes" seguem a lista selecionada no carrossel "Lista
  // (Pendente)" logo acima, não a soma de todas as pendentes — ver atualizarSelecao.
  renderCarrosselProximaCompra(pendentes);

  const meuToken = ++dashboardRenderToken;
  const promessaAgregados = preferenciaPeriodoDashboard() === "mes"
    ? computarAgregadosDoMesAtual()
    : getDoc(doc(bd, "espacos", espacoIdAtual, "estatisticas", "geral")).then((snap) => (snap.exists() ? snap.data() : {}));
  promessaAgregados.then((geral) => {
    if (meuToken !== dashboardRenderToken) return;
    const totalCompras = geral.totalComprasFinalizadas || 0;
    renderRankingItensPorQuantidade(geral.quantidadeItens || {});
    renderRankingDashboard("#dash-grupos-mais", geral.grupos || {}, (nome) => nome, "#dash-barra-grupos", totalCompras, geral.ultimaCompraGrupos || {});
    renderRankingDashboard("#dash-locais-mais", geral.locais || {}, (id) => locaisAtuais.find((l) => l.id === id)?.nome || id, undefined, totalCompras);
  }).catch(() => {});
}

// Carrossel de listas pendentes no card "Lembrete de Compras": arrastando entre as listas, o
// card "Itens pendentes" acompanha qual delas está visível no momento. Uma lista só some do
// carrossel quando é finalizada de verdade (filtro em `pendentes`, vindo de fora) — com todos os
// itens já marcados mas ainda sem finalizar, ela continua aqui, só que com o card laranja.
function renderCarrosselProximaCompra(pendentes) {
  const ordenadas = [...pendentes].sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
  const carrossel = $("#mini-carrossel-proxima");
  const pontos = $("#mini-carrossel-pontos");

  if (ordenadas.length === 0) {
    carrossel.innerHTML = `<div class="mini-carrossel-slide" style="color:var(--muted);font-weight:500;font-size:13px">Nenhuma</div>`;
    pontos.innerHTML = "";
    delete carrossel.dataset.idSelecionado;
    $("#dash-itens-pendentes").textContent = "0";
    $("#dash-valor-provisionado").textContent = formatarMoeda(0);
    $("#card-lista-proxima").classList.remove("status-pendente", "status-aguardando-finalizacao");
    return;
  }

  carrossel.innerHTML = ordenadas
    .map((l) => `<div class="mini-carrossel-slide" data-id="${l.id}">${esc(l.nome)}</div>`)
    .join("");
  pontos.innerHTML = ordenadas.length > 1 ? ordenadas.map((_, i) => `<span class="${i === 0 ? "ativo" : ""}"></span>`).join("") : "";

  function atualizarSelecao() {
    const idx = Math.min(ordenadas.length - 1, Math.max(0, Math.round(carrossel.scrollLeft / (carrossel.clientWidth || 1))));
    const lista = ordenadas[idx];
    $("#dash-itens-pendentes").textContent = String(Math.max((lista.qtdItens || 0) - (lista.qtdComprados || 0), 0));
    $("#dash-valor-provisionado").textContent = formatarMoeda(lista.valorProvisionadoTotal || 0);
    pontos.querySelectorAll("span").forEach((s, i) => s.classList.toggle("ativo", i === idx));
    carrossel.dataset.idSelecionado = lista.id;
    // Cor unificada com o badge da tela de Listas (ver statusVisualLista): vermelha só quando
    // nada foi marcado ainda, laranja assim que existe pelo menos 1 item marcado — a lista só sai
    // daqui quando finalizada de verdade (ver filtro de `pendentes`), então "comprada" (verde)
    // nunca acontece nesse card.
    const classeStatus = statusVisualLista(lista).classe;
    $("#card-lista-proxima").classList.toggle("status-pendente", classeStatus === "pendente");
    $("#card-lista-proxima").classList.toggle("status-aguardando-finalizacao", classeStatus === "aguardando-finalizacao");
  }

  let timeoutScrollProxima = null;
  carrossel.onscroll = () => {
    clearTimeout(timeoutScrollProxima);
    timeoutScrollProxima = setTimeout(atualizarSelecao, 80);
  };
  atualizarSelecao();
}

const CORES_RANKING = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#0891b2"];
// "minimoCompras" (opcional): com só 1 compra finalizada, todo local contaria como "1 ocorrência"
// — não é um ranking de verdade ainda, então fica vazio até haver mais de uma compra pra comparar.
// Usado em locais (contados por ocorrência); grupos (contado por quantidade) não precisa disso,
// já é comparável desde a 1ª compra.
// "ultimaCompraMap" desempata quando duas chaves têm a mesma contagem: a comprada mais
// recentemente aparece primeiro, em vez de ficar na ordem arbitrária que o Firestore devolve.
function renderRankingDashboard(seletorLista, mapa, resolverNome, seletorBarra, minimoCompras = Infinity, ultimaCompraMap = {}) {
  const entradas = Object.entries(mapa)
    .sort((a, b) => (b[1] - a[1]) || (ultimaCompraMap[b[0]] || "").localeCompare(ultimaCompraMap[a[0]] || ""))
    .slice(0, 5);
  const total = entradas.reduce((s, [, v]) => s + v, 0);
  const container = $(seletorLista);
  // Mensagem específica pro caso mais comum de "vazio" aqui — só existe 1 compra finalizada (ou
  // nenhuma), então ainda não há o que comparar. Sempre mostrada nesse caso, independente do mapa
  // já ter alguma entrada ou não, pra não sobrar ambiguidade sobre o motivo de estar vazio.
  if (minimoCompras < 2) {
    container.innerHTML = `<div class="dash-vazio">Finalize pelo menos mais uma compra — esse ranking só aparece depois de 2 compras pra comparar.</div>`;
    if (seletorBarra) $(seletorBarra).innerHTML = "";
    return;
  }
  if (entradas.length === 0) {
    container.innerHTML = `<div class="dash-vazio">Ainda sem dados — marque itens como comprados para ver aqui.</div>`;
    if (seletorBarra) $(seletorBarra).innerHTML = "";
    return;
  }
  container.innerHTML = entradas
    .map(([chave, contagem], i) => {
      const pct = total ? Math.round((contagem / total) * 100) : 0;
      return `<div class="item-aplicacao">
        <span class="dot" style="background:${CORES_RANKING[i % CORES_RANKING.length]}"></span>
        <span class="nome">${esc(resolverNome(chave))}</span>
        <span class="valor">${contagem}</span>
        <span class="percentual">${pct}%</span>
      </div>`;
    })
    .join("");
  if (seletorBarra) {
    $(seletorBarra).innerHTML = entradas
      .map(([, contagem], i) => `<div style="width:${total ? (contagem / total) * 100 : 0}%;background:${CORES_RANKING[i % CORES_RANKING.length]}"></div>`)
      .join("");
  }
}
// "Itens mais comprados" é sempre por quantidade/unidade (2kg de arroz aparece como "2kg"),
// nunca por ocorrência — diferente de grupos/locais, a contagem por ocorrência oscilava entre
// itens empatados (mesma contagem, mesma data) porque a ordem que o Firestore devolve os
// documentos não é estável entre leituras, e o desempate não tinha mais nenhum critério depois
// disso. Quantidade é um número gravado (não depende de ordem de leitura) e o nome como
// desempate final garante a mesma ordem sempre que duas quantidades empatam.
function renderRankingItensPorQuantidade(mapaQuantidade) {
  const container = $("#dash-itens-mais");
  const entradas = Object.entries(mapaQuantidade)
    .sort((a, b) => {
      const porQuantidade = b[1] - a[1];
      if (porQuantidade) return porQuantidade;
      const nomeA = itensAtuais.find((it) => it.id === a[0])?.nome || "";
      const nomeB = itensAtuais.find((it) => it.id === b[0])?.nome || "";
      return nomeA.localeCompare(nomeB, "pt-BR");
    })
    .slice(0, 5);
  if (entradas.length === 0) {
    container.innerHTML = `<div class="dash-vazio">Ainda sem dados — marque itens como comprados para ver aqui.</div>`;
    return;
  }
  const total = entradas.reduce((s, [, v]) => s + v, 0);
  container.innerHTML = entradas
    .map(([itemId, quantidade], i) => {
      const nome = itensAtuais.find((it) => it.id === itemId)?.nome || itemId;
      const numero = quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      const pct = total ? Math.round((quantidade / total) * 100) : 0;
      return `<div class="item-aplicacao">
        <span class="dot" style="background:${CORES_RANKING[i % CORES_RANKING.length]}"></span>
        <span class="nome">${esc(nome)}</span>
        <span class="valor">${numero}</span>
        <span class="percentual">${pct}%</span>
      </div>`;
    })
    .join("");
}

/* ---------- carrossel de listas ---------- */
// Filtro de mês/ano da tela "Listas de Compras" — sempre abre no mês atual (resetado em
// irParaTela) e nunca persiste entre visitas à tela. Um botão único "Agosto 2026" (em vez de dois
// <select>) abre um seletor próprio de mês/ano (sem dias) — o <input type="month"> nativo tem
// suporte inconsistente entre navegadores (Firefox, por exemplo, não implementa o picker — cai
// num texto simples onde não dá pra trocar o ano direito).
const NOMES_MESES_FILTRO = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
let filtroMesAnoListas = mesAnoAtual();
// Ano sendo navegado DENTRO do seletor aberto — separado do filtro aplicado, pra passear entre
// anos no picker sem mudar a lista mostrada por trás até escolher um mês de fato.
let anoExibidoSeletorMesAno = new Date().getFullYear();
// Tocar no ano do cabeçalho troca a grade de meses por uma grade de anos (em vez de só avançar/
// voltar um ano de cada vez nas setinhas) — mais rápido pra pular vários anos de uma vez.
let modoSeletorAno = false;
let anoBaseSeletorAno = 0;
const ANOS_POR_PAGINA_SELETOR = 12;
function atualizarRotuloMesAnoListas() {
  const [ano, mes] = filtroMesAnoListas.split("-");
  const el = $("#rotulo-mes-ano-listas");
  if (el) el.textContent = `${NOMES_MESES_FILTRO[Number(mes) - 1]} ${ano}`;
}
function aplicarFiltroMesAtualListas() {
  filtroMesAnoListas = mesAnoAtual();
  atualizarRotuloMesAnoListas();
}
function escolherMesAnoListas(mes, ano) {
  filtroMesAnoListas = `${ano}-${String(mes).padStart(2, "0")}`;
  atualizarRotuloMesAnoListas();
  fecharSeletorMesAno();
  renderCarrosselListas();
}
function alternarModoAnoSeletor() {
  modoSeletorAno = !modoSeletorAno;
  if (modoSeletorAno) {
    anoBaseSeletorAno = anoExibidoSeletorMesAno - Math.floor(ANOS_POR_PAGINA_SELETOR / 2);
  }
  renderGradeSeletorMesAno();
}
function escolherAnoSeletor(ano) {
  anoExibidoSeletorMesAno = ano;
  modoSeletorAno = false;
  renderGradeSeletorMesAno();
}
function renderGradeSeletorMesAno() {
  const hoje = new Date();
  if (modoSeletorAno) {
    $("#seletor-mes-ano-ano-exibido").textContent = `${anoBaseSeletorAno} - ${anoBaseSeletorAno + ANOS_POR_PAGINA_SELETOR - 1}`;
    $("#seletor-mes-ano-grade").innerHTML = Array.from({ length: ANOS_POR_PAGINA_SELETOR }, (_, i) => anoBaseSeletorAno + i)
      .map((ano) => {
        const selecionado = ano === anoExibidoSeletorMesAno;
        const atual = ano === hoje.getFullYear();
        const classe = selecionado ? " mes-selecionado" : atual ? " mes-atual" : "";
        return `<button type="button" class="seletor-mes-botao${classe}" data-ano="${ano}">${ano}</button>`;
      })
      .join("");
    $("#seletor-mes-ano-grade").querySelectorAll(".seletor-mes-botao").forEach((btn) => {
      btn.onclick = () => escolherAnoSeletor(Number(btn.dataset.ano));
    });
    return;
  }
  $("#seletor-mes-ano-ano-exibido").textContent = String(anoExibidoSeletorMesAno);
  const [anoSelecionado, mesSelecionado] = filtroMesAnoListas.split("-").map(Number);
  $("#seletor-mes-ano-grade").innerHTML = NOMES_MESES_FILTRO.map((nome, idx) => {
    const mes = idx + 1;
    const selecionado = anoExibidoSeletorMesAno === anoSelecionado && mes === mesSelecionado;
    const atual = anoExibidoSeletorMesAno === hoje.getFullYear() && mes === hoje.getMonth() + 1;
    const classe = selecionado ? " mes-selecionado" : atual ? " mes-atual" : "";
    return `<button type="button" class="seletor-mes-botao${classe}" data-mes="${mes}">${nome.slice(0, 3)}</button>`;
  }).join("");
  $("#seletor-mes-ano-grade").querySelectorAll(".seletor-mes-botao").forEach((btn) => {
    btn.onclick = () => escolherMesAnoListas(Number(btn.dataset.mes), anoExibidoSeletorMesAno);
  });
}
function abrirSeletorMesAno() {
  anoExibidoSeletorMesAno = Number(filtroMesAnoListas.split("-")[0]);
  modoSeletorAno = false;
  renderGradeSeletorMesAno();
  $("#overlay-seletor-mes-ano").classList.remove("hidden");
}
function fecharSeletorMesAno() {
  $("#overlay-seletor-mes-ano").classList.add("hidden");
}
// Soma o valor REAL (já com desconto, pagamentos batidos) só das compras finalizadas dentro do
// mês/ano filtrado — listas ainda pendentes não têm "valorTotalPago" de verdade, então não
// entram nessa conta (diferente do card individual, que mostra o provisionado pra elas).
function atualizarTotalListasMes() {
  const el = $("#total-listas-mes-valor");
  if (!el) return;
  const total = listasAtuais
    .filter((l) => l.finalizadaEm && mesAnoDoTimestamp(l.finalizadaEm) === filtroMesAnoListas)
    .reduce((s, l) => s + (l.valorTotalPago || 0), 0);
  el.textContent = formatarMoeda(total);
}
// Rótulo/cor do badge de status de uma lista — mesmo critério em toda parte que mostra o status
// (card da tela Listas de Compras, cabeçalho da lista aberta, card "Lembrete de Compras" da
// Início). Cor: vermelho quando nada foi marcado ainda (mesmo lista recém-criada sem item algum —
// "pendente" é sempre vermelho, sem exceção "neutra" pra lista vazia), laranja assim que existe
// pelo menos 1 item marcado (mesmo que faltem outros, ou mesmo já com todos marcados) e verde só
// depois de finalizada de fato (confirmarFinalizar) — pra não parecer concluída antes da hora.
// Rótulo: as duas situações "laranja" têm nomes diferentes ("Parcial" com itens faltando, "Não
// finalizada" com tudo já marcado) mesmo tendo a mesma cor, porque "Comprada" como rótulo único
// pra ambas só confundia (parecia concluída antes da hora).
function statusVisualLista(lista) {
  const status = lista.status || "pendente";
  const rotulo = lista.finalizadaEm
    ? "Concluída"
    : status === "pendente"
      ? "Pendente"
      : status === "comprada"
        ? "Não finalizada"
        : "Parcial";
  const classe = lista.finalizadaEm
    ? "comprada"
    : status === "pendente"
      ? "pendente"
      : "aguardando-finalizacao";
  return { rotulo, classe };
}
// O Safari do iOS (principalmente com o app instalado na tela de início, em modo standalone) às
// vezes "esquece" de recalcular a área rolável de um container quando o conteúdo é inserido
// depois que a tela já foi desenhada — caso de toda lista carregada de forma assíncrona via
// Firestore. O toque simplesmente não rola mais, mesmo com overflow-y:auto e conteúdo maior que
// o container. Alternar -webkit-overflow-scrolling força o WebKit a recalcular os limites.
function corrigirLimitesScrollIOS(elemento) {
  if (!elemento) return;
  // setProperty com o nome cru (com hífen) em vez de "elemento.style.webkitOverflowScrolling":
  // o mapeamento pra camelCase de propriedades com prefixo de fabricante varia entre navegadores
  // (WebkitOverflowScrolling com W maiúsculo é o correto pela spec) e um nome errado vira um
  // no-op silencioso, sem erro nenhum — setProperty não tem essa ambiguidade.
  elemento.style.setProperty("-webkit-overflow-scrolling", "auto");
  requestAnimationFrame(() => {
    elemento.style.setProperty("-webkit-overflow-scrolling", "touch");
  });
}
function renderCarrosselListas() {
  atualizarTotalListasMes();
  const container = $("#carrossel-listas");
  if (listasAtuais.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhuma lista ainda. Toque em “+” para criar a primeira.</div>`;
    corrigirLimitesScrollIOS(container.closest("main"));
    return;
  }
  // Cada lista é filtrada pela data que faz mais sentido pra ela: "finalizadaEm" (quando a
  // compra de fato aconteceu) se já tiver sido finalizada, senão "criadoEm" (ainda em andamento).
  const doMes = listasAtuais.filter((l) => mesAnoDoTimestamp(l.finalizadaEm ?? l.criadoEm) === filtroMesAnoListas);
  if (doMes.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhuma lista nesse mês.</div>`;
    corrigirLimitesScrollIOS(container.closest("main"));
    return;
  }
  const ordenadas = [...doMes].sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
  container.innerHTML = ordenadas
    .map((l) => {
      const status = l.status || "pendente";
      const { rotulo: rotuloStatus, classe: classeVisual } = statusVisualLista(l);
      const comprados = l.qtdComprados || 0;
      const pendentes = Math.max((l.qtdItens || 0) - comprados, 0);
      // Concluída: mostra provisionado (o esperado ORIGINAL de cada item, congelado no momento em
      // que entrou na lista — não muda mesmo que o item seja comprado por outro preço) x real (já
      // com desconto aplicado) e a diferença entre os dois — vermelho passou do previsto, verde
      // economizou. Ex.: item lançado a R$10 e comprado por R$20 aparece como +R$10, não como o
      // desconto do fechamento da compra (esse já está embutido no "Real").
      const provisionadoOriginal = l.valorProvisionadoOriginalTotal ?? l.valorProvisionadoTotal ?? 0;
      const diferenca = (l.valorTotalPago || 0) - provisionadoOriginal;
      const corDiferenca = diferenca > 0 ? "var(--status-vermelho)" : diferenca < 0 ? "var(--status-verde)" : "var(--muted)";
      const comparativo = status === "comprada" && l.valorTotalPago != null
        ? `<div class="card-lista-comparativo">
            <span>Provisionado: ${formatarMoeda(provisionadoOriginal)}</span>
            <span>Real: ${formatarMoeda(l.valorTotalPago || 0)}</span>
            <span style="color:${corDiferenca}">Diferença: ${diferenca > 0 ? "+" : ""}${formatarMoeda(diferenca)}</span>
          </div>`
        : "";
      // O total no topo do card acompanha o progresso da compra: enquanto não finalizada, é a
      // soma dinâmica dos itens (provisionado + já pago); uma vez finalizada, vira o valor real
      // final já com desconto aplicado (valorTotalPago), não a soma "crua" dos itens.
      const valorTopo = l.finalizadaEm ? (l.valorTotalPago ?? l.valorProvisionadoTotal ?? 0) : (l.valorProvisionadoTotal || 0);
      return `<div class="card-lista status-${classeVisual}" data-id="${l.id}">
        <div class="card-lista-topo">
          <div>
            <div class="card-lista-titulo">${esc(l.nome)}</div>
            ${l.finalizadaEm ? `<div class="card-lista-obs">${ICONE_CALENDARIO}Concluída em ${formatarDataHoraBR(l.finalizadaEm)}</div>` : ""}
            ${l.observacoes ? `<div class="card-lista-obs">${esc(l.observacoes)}</div>` : ""}
          </div>
          <span class="badge-status ${classeVisual}">${l.permanente ? "Permanente" : rotuloStatus}</span>
        </div>
        <div class="card-lista-rodape">
          <span>${l.qtdItens || 0} ${(l.qtdItens || 0) === 1 ? "Item" : "Itens"}</span>
          <span class="valor">${formatarMoeda(valorTopo)}</span>
        </div>
        <div class="card-lista-resumo-itens">
          <span><span class="icone-comprado">✓</span> ${comprados} comprado${comprados === 1 ? "" : "s"}</span>
          <span><span class="icone-pendente">×</span> ${pendentes} pendente${pendentes === 1 ? "" : "s"}</span>
          <span class="card-lista-acoes">
            ${l.finalizadaEm ? `<button type="button" class="btn-detalhes-card" data-id-detalhes="${l.id}">Detalhes</button>` : ""}
            <button type="button" class="btn-compartilhar-card" data-id-compartilhar="${l.id}" aria-label="Compartilhar no WhatsApp" title="Compartilhar no WhatsApp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M21 3 11 13"/><path d="M21 3 14.5 21l-3.5-8L3 9.5 21 3Z"/></svg></button>
          </span>
        </div>
        ${comparativo}
      </div>`;
    })
    .join("");
  container.querySelectorAll(".card-lista").forEach((el) => {
    el.onclick = () => abrirListaDetalhe(listasAtuais.find((l) => l.id === el.dataset.id));
  });
  container.querySelectorAll(".btn-compartilhar-card").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      compartilharListaWhatsApp(listasAtuais.find((l) => l.id === btn.dataset.idCompartilhar));
    };
  });
  container.querySelectorAll(".btn-detalhes-card").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      abrirModalDetalhesCompra(listasAtuais.find((l) => l.id === btn.dataset.idDetalhes));
    };
  });
  corrigirLimitesScrollIOS(container.closest("main"));
}

/* ---------- formulário nova/editar lista ---------- */
function abrirFormNovaLista() {
  telaAnterior = "listas";
  $("#fn-id").value = "";
  $("#fn-nome").value = "";
  $("#fn-observacoes").value = "";
  $("#btn-excluir-lista").classList.add("hidden");
  mostrarMsg("#msg-form-lista", "", "");
  mostrarTelaCheia("form-lista", "Nova lista");
}
function abrirFormEditarLista(lista) {
  telaAnterior = "listas";
  $("#fn-id").value = lista.id;
  $("#fn-nome").value = lista.nome;
  $("#fn-observacoes").value = lista.observacoes || "";
  $("#btn-excluir-lista").classList.remove("hidden");
  // "Reabrir" também fica acessível aqui (não só no rodapé da tela de detalhe) — é o lugar mais
  // intuitivo pra quem já finalizou a compra e quer desfazer, mesmo já estando na tela de editar.
  $("#btn-reabrir-lista-editar").classList.toggle("hidden", !lista.finalizadaEm);
  mostrarMsg("#msg-form-lista", "", "");
  mostrarTelaCheia("form-lista", "Editar lista");
}
async function salvarLista() {
  const id = $("#fn-id").value;
  const nome = $("#fn-nome").value.trim();
  const permanente = id ? !!listasAtuais.find((l) => l.id === id)?.permanente : false;
  const observacoes = $("#fn-observacoes").value.trim() || null;
  if (!nome) {
    mostrarMsg("#msg-form-lista", "Preencha o nome da lista.", "erro");
    return;
  }
  const parecida = id ? null : encontrarNomeParecido(nome, listasAtuais);
  if (parecida) {
    const rotuloStatus = statusVisualLista(parecida).rotulo;
    const confirma = confirmarApesarDeParecido([
      `Nome: ${parecida.nome}`,
      `Status: ${parecida.permanente ? "Permanente" : rotuloStatus}`,
      parecida.observacoes ? `Observações: ${parecida.observacoes}` : null,
    ]);
    if (!confirma) return;
  }
  $("#btn-salvar-lista").disabled = true;
  try {
    if (id) {
      await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", id), { nome, observacoes, permanente });
    } else {
      await addDoc(collection(bd, "espacos", espacoIdAtual, "listas"), {
        nome, observacoes, permanente,
        status: "pendente", qtdItens: 0, qtdComprados: 0, valorProvisionadoTotal: 0,
        criadoPor: usuario.uid, criadoEm: serverTimestamp(),
        finalizadaEm: null, pagamentos: null, valorTotalPago: null, desconto: null,
      });
      notificarMembrosEspaco(`${nomeExibicaoUsuario()} criou a lista "${nome}".`);
    }
    exibirSucesso("Lista salva com sucesso!");
    irParaTela("listas");
  } catch {
    mostrarMsg("#msg-form-lista", "Não foi possível salvar. Tente novamente.", "erro");
  }
  $("#btn-salvar-lista").disabled = false;
}
// Recomputa "estatisticas/geral" (itens/grupos/locais mais usados) E o total provisionado de
// cada lista finalizada, sempre do ZERO a partir das listas realmente finalizadas agora — nunca
// por increment/decrement. Chamado depois de qualquer evento que muda quais listas contam como
// finalizadas (finalizar, reabrir, excluir): incrementar na finalização e tentar decrementar de
// volta ao reabrir/excluir é frágil — qualquer mudança futura na fórmula de contagem (como já
// aconteceu aqui) deixa o incremento e o decremento fora de sincronia pra sempre, e o painel
// nunca mais volta a bater. Recalcular do zero a cada evento elimina esse tipo de drift de vez.
// Nunca deixa uma falha no recálculo travar o resto do fluxo (fechar modal, aviso de sucesso) —
// finalizar/reabrir/excluir a lista em si já terminou com sucesso quando isso é chamado; os
// dashboards são um "extra" que pode falhar sem invalidar a ação principal. Mostra o erro tanto
// no console quanto num alerta visível, pra dar pra diagnosticar sem precisar abrir o DevTools.
async function recomputarEstatisticasSeguro(contexto) {
  try {
    await recomputarEstatisticasELista();
  } catch (e) {
    console.error(`Falha ao recalcular estatísticas (${contexto}):`, e);
    alert(`Não foi possível atualizar os dashboards agora (${contexto}). Os dados da lista foram salvos normalmente. Detalhe do erro: ${e?.message || e}`);
  }
}
// Acumula grupos/locais/quantidades de UMA lista (itensLista já carregados) num acumulador
// compartilhado — usado tanto no recálculo geral (todas as listas finalizadas, persistido em
// "estatisticas/geral") quanto no cálculo sob demanda do dashboard "só o mês atual" (não
// persistido, ver computarAgregadosDoMesAtual), pra não duplicar essa regra em dois lugares.
function novoAcumuladorAgregados() {
  return { contagemGrupos: {}, contagemLocais: {}, quantidadeItens: {}, unidadeItens: {}, ultimaCompraGrupos: {} };
}
function acumularAgregadosDeItensLista(todosItens, acc) {
  const comprados = todosItens.filter((i) => i.comprado && i.valorPago > 0 && i.localCompraId);
  // Grupos e locais: por ocorrência (1 por compra em que apareceu) — não deixa algo comprado em
  // grande quantidade, mas raramente, dominar o ranking de frequência.
  comprados.forEach((i) => {
    const dataCompra = i.compradoEm || "";
    acc.quantidadeItens[i.itemId] = (acc.quantidadeItens[i.itemId] || 0) + (i.quantidade || 0);
    acc.unidadeItens[i.itemId] = i.unidade;
    acc.contagemLocais[i.localCompraId] = (acc.contagemLocais[i.localCompraId] || 0) + 1;
    const grupo = i.grupoNome || "Outros";
    acc.contagemGrupos[grupo] = (acc.contagemGrupos[grupo] || 0) + 1;
    // Data da compra mais recente de cada grupo — desempata o ranking quando duas chaves têm a
    // mesma contagem (sem isso, o empate ficava na ordem meio arbitrária em que o Firestore
    // devolve os documentos, sem nenhum critério visível pra quem está olhando o dashboard).
    if (dataCompra > (acc.ultimaCompraGrupos[grupo] || "")) acc.ultimaCompraGrupos[grupo] = dataCompra;
  });
}
// Dashboard "só o mês atual" (preferência em Configurações) — calculado na hora a partir de
// listasAtuais (já carregado, sem precisar de outro getDocs) e não é persistido em lugar nenhum,
// diferente de "estatisticas/geral" (que cobre todas as listas finalizadas e é recalculado só nos
// eventos que mudam quais listas contam como finalizadas — ver recomputarEstatisticasELista).
async function computarAgregadosDoMesAtual() {
  const doMes = listasAtuais.filter((l) => l.finalizadaEm && mesAnoDoTimestamp(l.finalizadaEm) === mesAnoAtual());
  const acc = novoAcumuladorAgregados();
  for (const lista of doMes) {
    const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", lista.id, "itensLista"));
    acumularAgregadosDeItensLista(snap.docs.map((d) => d.data()), acc);
  }
  return {
    grupos: acc.contagemGrupos, locais: acc.contagemLocais, totalComprasFinalizadas: doMes.length,
    ultimaCompraGrupos: acc.ultimaCompraGrupos, quantidadeItens: acc.quantidadeItens, unidadeItens: acc.unidadeItens,
  };
}
async function recomputarEstatisticasELista() {
  const snapListas = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas"));
  const finalizadas = snapListas.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.finalizadaEm);
  const acc = novoAcumuladorAgregados();
  const atualizacoesPorLista = [];
  for (const lista of finalizadas) {
    const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", lista.id, "itensLista"));
    const todosItens = snap.docs.map((d) => d.data());
    acumularAgregadosDeItensLista(todosItens, acc);
    // Também corrige o "Provisionado" dessa lista (usado na "Diferença" do resumo) — itens
    // lançados antes de "subtotalProvisionado" existir têm o valor original reconstruído aqui.
    const qtdItens = somaQuantidades(todosItens);
    const qtdComprados = somaQuantidades(todosItens.filter((i) => i.comprado));
    const valorProvisionadoTotal = todosItens.reduce((s, i) => s + (i.subtotal || 0), 0);
    const valorProvisionadoOriginalTotal = todosItens.reduce((s, i) => s + (i.subtotalProvisionado ?? (i.quantidade || 0) * (i.valorProvisionado || 0)), 0);
    const status = qtdComprados === 0 ? "pendente" : qtdComprados === qtdItens && qtdItens > 0 ? "comprada" : "parcial";
    atualizacoesPorLista.push({ id: lista.id, dados: { qtdItens, qtdComprados, valorProvisionadoTotal, valorProvisionadoOriginalTotal, status } });
  }
  // Grava o agregado ANTES de atualizar cada lista (abaixo) — cada updateDoc de lista dispara o
  // listener da coleção "listas", que chama renderDashboard() de novo por conta própria; se o
  // agregado ainda não estivesse pronto nesse momento, esse render concorrente podia ler
  // "estatisticas/geral" desatualizado e sobrescrever a tela com dados velhos/vazios por cima do
  // resultado certo. Gravando primeiro, qualquer render (o meu ou o do listener) já lê o final.
  await setDoc(doc(bd, "espacos", espacoIdAtual, "estatisticas", "geral"), {
    grupos: acc.contagemGrupos, locais: acc.contagemLocais, totalComprasFinalizadas: finalizadas.length,
    ultimaCompraGrupos: acc.ultimaCompraGrupos, quantidadeItens: acc.quantidadeItens, unidadeItens: acc.unidadeItens,
  });
  for (const { id, dados } of atualizacoesPorLista) {
    await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", id), dados);
  }
  renderDashboard();
}
// Apaga o histórico de preços gerado por uma lista específica (listaId), em qualquer item —
// usado ao excluir a lista e ao reabri-la (reabrir exige finalizar de novo pra gravar o que for
// editado, então o histórico da rodada anterior teria dados incompletos/desatualizados).
async function apagarHistoricoDaLista(listaId) {
  await Promise.all(itensAtuais.map(async (item) => {
    const snap = await getDocs(query(collection(bd, "espacos", espacoIdAtual, "itens", item.id, "historicoPrecos"), where("listaId", "==", listaId)));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }));
}
async function excluirListaAtual() {
  const id = $("#fn-id").value;
  if (!id) return;
  const lista = listasAtuais.find((l) => l.id === id);
  // Concluída pode ser excluída também, mas avisa antes: junto com a lista, some o histórico de
  // preços que ELA gerou (a linha do valor de cadastro e o histórico de outras compras continuam).
  const mensagem = lista?.status === "comprada"
    ? "Esta lista já está concluída. Tem certeza que deseja excluí-la? O histórico de preços registrado por essa compra também será apagado (o valor do cadastro e o histórico de outras compras continuam intactos)."
    : "Tem certeza que deseja excluir esta lista e todos os seus itens?";
  if (!confirm(mensagem)) return;
  const itensSnap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", id, "itensLista"));
  await Promise.all(itensSnap.docs.map((d) => deleteDoc(d.ref)));
  await apagarHistoricoDaLista(id);
  await deleteDoc(doc(bd, "espacos", espacoIdAtual, "listas", id));
  // Recalcula do zero com a lista já excluída — ela some sozinha da contagem, sem precisar
  // desfazer nada manualmente (ver recomputarEstatisticasELista).
  if (lista?.finalizadaEm) await recomputarEstatisticasSeguro("excluir lista");
  irParaTela("listas");
}

/* ---------- lista (detalhe) ---------- */
function renderChips(seletorContainer, valores, valorAtivo, aoSelecionar) {
  const container = $(seletorContainer);
  if (!valores.length) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML =
    `<button type="button" class="chip ${!valorAtivo ? "ativo" : ""}" data-valor="">Todos</button>` +
    valores.map((v) => `<button type="button" class="chip ${v === valorAtivo ? "ativo" : ""}" data-valor="${esc(v)}">${esc(v)}</button>`).join("");
  container.querySelectorAll(".chip").forEach((btn) => {
    btn.onclick = () => aoSelecionar(btn.dataset.valor || null);
  });
}

function abrirListaDetalhe(lista) {
  if (!lista) return;
  listaAbertaId = lista.id;
  filtroGrupoLista = null;
  // Lista já finalizada abre direto ordenada por nome (A-Z) — é o que faz mais sentido pra
  // conferir o que foi comprado; pendente não usa essa ordenação então o valor não importa.
  ordenacaoListaFinalizada = lista.finalizadaEm ? "nome" : null;
  direcaoOrdenacaoListaFinalizada = "asc";
  ultimoLocalUsadoId = null;
  carregarLocalMaisUsado();
  telaAnterior = "listas";
  if (unsubItensLista) unsubItensLista();
  unsubItensLista = onSnapshot(collection(bd, "espacos", espacoIdAtual, "listas", lista.id, "itensLista"), (snap) => {
    itensListaAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderListaDetalhe();
  });
  mostrarTelaCheia("lista-detalhe", "Lista de Compras");
  fecharFormAdicionarItem();
}

function listaAbertaAtual() {
  return listasAtuais.find((l) => l.id === listaAbertaId);
}
// "lista-detalhe" não é uma tela principal (irParaTela não sabe reabri-la com o título e os
// dados certos) — quando um formulário foi aberto de dentro de uma lista (voltar, cancelar ou
// terminar de salvar), volta pra essa lista em vez de ir pra tela de cadastro genérica.
function voltarParaTelaAnterior() {
  const lista = telaAnterior === "lista-detalhe" ? listaAbertaAtual() : null;
  if (lista) abrirListaDetalhe(lista);
  else irParaTela(telaAnterior);
}

// "Convidar Amigo" no menu: usa o share sheet nativo do celular quando disponível (deixa a
// pessoa escolher WhatsApp, SMS, e-mail etc.); em navegador sem suporte, cai pro link do WhatsApp.
function convidarAmigo() {
  const link = `${window.location.origin}/mobile`;
  const texto = `🛒 Estou usando este app de lista de compras compartilhada e achei muito prático! Com ele podemos criar listas em conjunto, acompanhar alterações em tempo real, comparar preços entre mercados e controlar o que já foi comprado ou ainda está pendente. Experimente! ${link}`;
  if (navigator.share) {
    navigator.share({ title: "Listô", text: texto, url: link }).catch(() => {});
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
  }
}

// Busca o index.html direto do servidor (sem cache) pra ler a versão publicada
// (id="app-versao", incrementada a cada commit). Retorna null se não conseguir checar.
async function buscarVersaoServidor() {
  if (!navigator.onLine) return null;
  try {
    const resp = await fetch(`/mobile/index.html?t=${Date.now()}`, { cache: "no-store" });
    const html = await resp.text();
    return html.match(/id="app-versao">([^<]+)</)?.[1] || null;
  } catch {
    return null;
  }
}

// Checagem silenciosa (chamada no login, ao voltar pro app e periodicamente): se encontrar uma
// versão publicada diferente da que está rodando, avisa no sino de notificações — mas NÃO
// aplica a atualização sozinha. A troca de versão só acontece quando a pessoa toca em
// "Atualização" no menu (verificarAtualizacao). Usa localStorage pra avisar só uma vez por versão.
async function avisarSeNovaVersaoDisponivel() {
  if (!usuario || !bd) return;
  const versaoServidor = await buscarVersaoServidor();
  const versaoAtual = $("#app-versao")?.textContent?.trim();
  if (!versaoServidor || versaoServidor === versaoAtual) return;
  if (localStorage.getItem("versaoAvisada") === versaoServidor) return;
  localStorage.setItem("versaoAvisada", versaoServidor);
  try {
    await addDoc(collection(bd, "notificacoes"), {
      tipo: "atualizacao_disponivel", uidDestino: usuario.uid, espacoId: espacoIdAtual,
      mensagem: `Uma nova versão do Listô está disponível (${versaoServidor}). Toque em "Atualização" no menu para instalar.`,
      criadoEm: serverTimestamp(), lida: false,
    });
  } catch {
    // checagem em segundo plano: falha ao gravar a notificação não deve incomodar o usuário
  }
}

// "Atualização" no menu: compara a versão publicada com a que está rodando na tela. Se houver
// diferença, espera qualquer gravação pendente no Firestore terminar de sincronizar, limpa o
// cache do service worker e recarrega — assim a pessoa não precisa criar um novo atalho pra
// receber a versão nova.
async function verificarAtualizacao() {
  if (!navigator.onLine) {
    exibirSucesso("Sem conexão para verificar atualizações.");
    return;
  }
  const versaoServidor = await buscarVersaoServidor();
  const versaoAtual = $("#app-versao")?.textContent?.trim();

  if (!versaoServidor) {
    exibirSucesso("Não foi possível verificar atualizações agora. Tente novamente.");
    return;
  }
  if (versaoServidor === versaoAtual) {
    exibirSucesso(`O Listô já está com a versão mais atualizada (${versaoAtual}).`);
    return;
  }

  if (bd) await waitForPendingWrites(bd).catch(() => {});

  if ("caches" in window) {
    const nomes = await caches.keys();
    await Promise.all(nomes.map((n) => caches.delete(n)));
  }
  const registro = await navigator.serviceWorker?.getRegistration();
  if (registro) await registro.update();

  sessionStorage.setItem("avisoPosAtualizacao", `Listô foi atualizado para a versão ${versaoServidor}.`);
  location.reload();
}

// Recebe a lista diretamente (em vez de depender de qual lista está "aberta" no momento) porque
// agora é acionado a partir do resumo na tela "Listas de Compras", sem precisar entrar na lista.
async function compartilharListaWhatsApp(lista) {
  if (!lista) return;
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", lista.id, "itensLista"));
  const linhas = snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.grupoNome || "").localeCompare(b.grupoNome || "") || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((i) => `${i.comprado ? "✅" : "🔲"} ${i.nome} - ${i.quantidade}${i.unidade ? ` ${i.unidade}` : ""}`)
    .join("\n");
  const texto = `🛒 *${lista.nome}*\n\n${linhas || "Nenhum item ainda."}\n\nTotal previsto: ${formatarMoeda(lista.valorProvisionadoTotal || 0)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
}

// Assim como compartilharListaWhatsApp, recebe a lista direto (acionado a partir do resumo na
// tela "Listas de Compras") e busca os itens na hora — só faz sentido pra lista já finalizada.
async function abrirModalDetalhesCompra(lista) {
  if (!lista) return;
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", lista.id, "itensLista"));
  const itens = snap.docs.map((d) => d.data());
  const comprados = itens.filter((i) => i.comprado);
  const pendentes = itens.filter((i) => !i.comprado);
  // Mesma conta do card na tela de Listas (somaQuantidades): cada item conta pela quantidade, não
  // por linha — 3un do mesmo item conta como 3, não como 1 linha.
  const qtdItens = somaQuantidades(itens);
  const qtdComprados = somaQuantidades(comprados);
  const qtdPendentes = somaQuantidades(pendentes);

  const ordenadosPorValor = [...comprados].sort((a, b) => (a.subtotal || 0) - (b.subtotal || 0));
  const maisBarato = ordenadosPorValor[0];
  const maisCaro = ordenadosPorValor[ordenadosPorValor.length - 1];

  const idsLocais = [...new Set(comprados.map((i) => i.localCompraId).filter(Boolean))];
  const nomesLocais = idsLocais.map((id) => locaisAtuais.find((l) => l.id === id)?.nome || "—").join(", ");

  const provisionado = lista.valorProvisionadoOriginalTotal ?? lista.valorProvisionadoTotal ?? 0;
  const real = lista.valorTotalPago ?? 0;
  const diferenca = real - provisionado;
  const corDiferenca = diferenca > 0 ? "var(--status-vermelho)" : diferenca < 0 ? "var(--status-verde)" : "var(--muted)";

  const linhasPagamento = (lista.pagamentos || []).map((p) => {
    const forma = formasAtuais.find((f) => f.id === p.formaPagamentoId)?.nome || "—";
    const parcelas = p.parcelas > 1 ? ` em ${p.parcelas}x` : "";
    return [`Pagamento (${forma})`, `${formatarMoeda(p.valor)}${parcelas}`];
  });

  const linhas = [
    ["Data e hora", formatarDataHoraBR(lista.finalizadaEm) || "—"],
    ["Local", nomesLocais || "—"],
    ["Itens", `${qtdItens} (${qtdComprados} comprado${qtdComprados === 1 ? "" : "s"}, ${qtdPendentes} pendente${qtdPendentes === 1 ? "" : "s"})`],
    ...(pendentes.length > 0 ? [["Pendentes", pendentes.map((i) => i.nome).join(", ")]] : []),
    ["Item mais caro", maisCaro ? `${maisCaro.nome} (${formatarMoeda(maisCaro.subtotal)})` : "—"],
    ["Item mais barato", maisBarato ? `${maisBarato.nome} (${formatarMoeda(maisBarato.subtotal)})` : "—"],
    ...linhasPagamento,
    ["Desconto", formatarMoeda(lista.desconto || 0)],
    ["Provisionado", formatarMoeda(provisionado)],
    ["Total da compra (real)", formatarMoeda(real)],
  ];

  $("#detalhes-compra-conteudo").innerHTML =
    linhas.map(([r, v]) => `<div class="detalhe-linha"><span class="rotulo">${esc(r)}</span><span class="valor-detalhe">${esc(String(v))}</span></div>`).join("") +
    `<div class="detalhe-linha"><span class="rotulo">Diferença</span><span class="valor-detalhe" style="color:${corDiferenca}">${diferenca > 0 ? "+" : ""}${formatarMoeda(diferenca)}</span></div>`;

  $("#overlay-detalhes-compra").classList.remove("hidden");
}
function fecharModalDetalhesCompra() {
  $("#overlay-detalhes-compra").classList.add("hidden");
}

// Preço unitário mostrado na linha pequena (R$/kg, R$/un...): "valorPago" já é por unidade (ver
// confirmarCompra), então depois de comprado mostra ele direto; "valorProvisionado" continua
// guardando o estimado original (não é sobrescrito), como referência pra seta e pro que volta a
// aparecer se o item for desmarcado como comprado.
function valorUnitarioExibido(item) {
  if (item.comprado && item.valorPago > 0) return item.valorPago;
  return item.valorProvisionado || 0;
}
// Compara o total realmente pago (subtotal, já calculado com a quantidade real) com o que
// estava provisionado (quantidade × valor unitário provisionado) antes da compra.
function tendenciaValorPago(item) {
  if (!item.comprado || !(item.valorPago > 0)) return null;
  const previsto = Math.round((item.quantidade || 0) * (item.valorProvisionado || 0) * 100);
  const pago = Math.round((item.subtotal || 0) * 100);
  if (!previsto || pago === previsto) return null;
  return pago < previsto ? "queda" : "alta";
}

function renderListaDetalhe() {
  const lista = listaAbertaAtual();
  if (!lista) return;

  const { rotulo: rotuloStatus, classe: classeVisualStatus } = statusVisualLista(lista);

  const gruposDaLista = [...new Set(itensListaAtuais.map((i) => i.grupoNome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  renderChips("#filtros-lista-grupo", gruposDaLista, filtroGrupoLista, (v) => { filtroGrupoLista = v; renderListaDetalhe(); });

  let itens = itensListaAtuais;
  if (filtroGrupoLista) itens = itens.filter((i) => i.grupoNome === filtroGrupoLista);

  // Contagem e total no cabeçalho seguem o filtro atual: com "Todos" é a lista inteira,
  // filtrando por grupo só mostra essa fatia.
  const qtdComprados = somaQuantidades(itens.filter((i) => i.comprado));
  const qtdPendentes = Math.max(somaQuantidades(itens) - qtdComprados, 0);
  const valorTotal = itens.reduce((s, i) => s + (i.subtotal || 0), 0);
  $("#lista-detalhe-cabecalho").innerHTML = `
    <div class="detalhe-titulo-credor">
      <span class="detalhe-nome-lista">${esc(lista.nome)}</span>
      <span class="badge-status ${classeVisualStatus}">${lista.permanente ? "Permanente" : rotuloStatus}</span>
      <button type="button" class="btn-editar-lista-mini" id="btn-abrir-editar-lista" aria-label="Editar lista"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
    </div>
    <div class="card-lista-rodape" style="margin-bottom:6px">
      <span><span class="icone-comprado">✓</span> ${qtdComprados} comprado${qtdComprados === 1 ? "" : "s"} · <span class="icone-pendente">×</span> ${qtdPendentes} pendente${qtdPendentes === 1 ? "" : "s"}</span>
      <span class="valor">${formatarMoeda(valorTotal)}</span>
    </div>
    ${!lista.finalizadaEm && !lista.permanente ? `
    <div class="lista-detalhe-finalizar">
      <button type="button" class="btn" id="btn-finalizar-compra">Finalizar compra</button>
    </div>` : ""}`;
  $("#btn-abrir-editar-lista").onclick = () => abrirFormEditarLista(lista);
  // Lista finalizada: nada de marcar, editar quantidade ou incluir item novo — só dá pra excluir
  // a lista inteira ou reabri-la primeiro (reabrir já libera tudo de novo).
  if (lista.finalizadaEm) fecharFormAdicionarItem();
  $("#wrap-adicionar-item").classList.toggle("hidden", !!lista.finalizadaEm);

  // Ordenação por nome/valor só faz sentido numa lista já finalizada (comprar itens embaralha
  // a ordem qualquer forma) — pendente continua com a ordem padrão de sempre.
  $("#ordenacao-lista-finalizada").classList.toggle("hidden", !lista.finalizadaEm);
  const SETA_ORDENACAO = { asc: "↑", desc: "↓" };
  ["nome", "valor"].forEach((tipo) => {
    const btn = $(`#btn-ordenar-lista-${tipo}`);
    const ativo = ordenacaoListaFinalizada === tipo;
    btn.classList.toggle("ativo", ativo);
    const rotulo = tipo === "nome" ? "Ordenar por nome" : "Ordenar por valor";
    btn.textContent = ativo ? `${rotulo} ${SETA_ORDENACAO[direcaoOrdenacaoListaFinalizada]}` : rotulo;
  });

  if (lista.finalizadaEm && ordenacaoListaFinalizada) {
    const mult = direcaoOrdenacaoListaFinalizada === "asc" ? 1 : -1;
    itens = [...itens].sort((a, b) => ordenacaoListaFinalizada === "nome"
      ? mult * a.nome.localeCompare(b.nome, "pt-BR")
      : mult * ((a.subtotal || 0) - (b.subtotal || 0)));
  } else {
    itens = [...itens].sort((a, b) => {
      if (a.comprado !== b.comprado) return a.comprado ? 1 : -1;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }

  const espacoCompartilhado = (espacoAtual.membros || []).length > 1;

  const container = $("#itens-da-lista");
  if (itens.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhum item nesta lista ainda.</div>`;
  } else {
    container.innerHTML = itens
      .map((i) => {
        // Itens adicionados antes de marca/descrição existirem no itensLista caem no cadastro atual.
        const catalogo = itensAtuais.find((it) => it.id === i.itemId);
        // Texto corrido numa linha só (com "..." se não couber) em vez de span por parte — com
        // vários pedaços (marca, descrição, descrição da unidade) o flex-wrap quebrava no meio de
        // uma palavra a qualquer momento, inclusive separando nome e sobrenome de quem lançou.
        const partes = [i.marca ?? catalogo?.marca, i.descricao ?? catalogo?.descricao, i.descricaoUnidade ?? catalogo?.descricaoUnidade].filter(Boolean);
        const detalhe = partes.map((p) => esc(p)).join(" · ");
        // Local e nome de quem lançou agora em linhas próprias (não mais juntos com " · ") — só
        // existe depois que o item é marcado como comprado (é aí que o local da compra é
        // escolhido, ver abrirModalComprar).
        const nomeLocalCompra = i.localCompraId ? locaisAtuais.find((l) => l.id === i.localCompraId)?.nome : null;
        const localCompra = nomeLocalCompra ? `<div class="local-compra-item">${ICONE_LOCAL}${esc(nomeLocalCompra)}</div>` : "";
        const adicionadoPor = espacoCompartilhado && i.adicionadoPorNome
          ? `<div class="adicionado-por">${ICONE_PESSOA}${esc(i.adicionadoPorNome)}</div>`
          : "";
        return `
      <div class="item ${i.comprado ? "comprado" : ""}" data-id="${i.id}">
        <div class="chk-col">
          <button class="chk" data-acao="marcar" ${lista.finalizadaEm ? "disabled" : ""}>✓</button>
          <button class="btn-trocar-item" data-acao="trocar" title="Trocar item" aria-label="Trocar item" ${i.comprado || lista.finalizadaEm ? "disabled" : ""}>${ICONE_TROCAR}</button>
        </div>
        <div class="info">
          <div class="nome">${esc(i.nome)}</div>
          ${detalhe ? `<div class="detalhe detalhe-truncado">${detalhe}</div>` : ""}
          ${localCompra}
          ${adicionadoPor}
        </div>
        <button class="btn-qtd" data-acao="qtd" ${lista.finalizadaEm ? "disabled" : ""}>${esc(formatarQuantidadeLista(i))}</button>
        <div class="valor-linha">
          <span class="valor-unitario">${formatarMoeda(valorUnitarioExibido(i))}/${esc(abreviarUnidade(i.unidade))}</span>
          <span class="valor">${formatarMoeda(i.subtotal)}${setaTendenciaHtml(tendenciaValorPago(i), true)}</span>
        </div>
        ${lista.finalizadaEm ? "" : `<button class="btn-excluir-linha" data-acao="excluir">✕</button>`}
      </div>`;
      })
      .join("");
    container.querySelectorAll('[data-acao="marcar"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const item = itensListaAtuais.find((i) => i.id === btn.closest(".item").dataset.id);
        if (item.comprado) desmarcarComprado(item);
        else abrirModalComprar(item.id);
      };
    });
    container.querySelectorAll('[data-acao="trocar"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        abrirModalTrocarItem(btn.closest(".item").dataset.id);
      };
    });
    container.querySelectorAll('[data-acao="excluir"]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.closest(".item").dataset.id;
        const item = itensListaAtuais.find((i) => i.id === id);
        const nomeItem = item?.nome ?? "";
        if (!confirm(`Remover "${nomeItem}" da lista?`)) return;
        await deleteDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista", id));
        recalcularTotaisLista();
        exibirSucesso(`Item "${nomeItem}" removido da lista.`);
      };
    });
    container.querySelectorAll('[data-acao="qtd"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        abrirModalQuantidade(btn.closest(".item").dataset.id);
      };
    });
    container.querySelectorAll(".item").forEach((el) => {
      el.onclick = () => {
        const itemLista = itensListaAtuais.find((i) => i.id === el.dataset.id);
        const itemCatalogo = itensAtuais.find((i) => i.id === itemLista?.itemId);
        if (itemCatalogo) abrirItemDetalhe(itemCatalogo, "lista-detalhe");
      };
    });
  }

  atualizarBtnFinalizarCompra();
}
async function reabrirLista() {
  if (!listaAbertaId) return;
  if (!confirm("Reabrir esta lista? Você poderá voltar a marcar, editar e excluir itens. Como vai precisar finalizar de novo pra gravar o que for alterado, o histórico de preços e as estatísticas dessa compra são apagados agora (voltam a existir quando a lista for finalizada de novo).")) return;
  await apagarHistoricoDaLista(listaAbertaId);
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId), {
    finalizadaEm: null, pagamentos: null, valorTotalPago: null, desconto: null,
  });
  // Recalcula do zero com a lista já fora da lista de finalizadas — ela some sozinha da
  // contagem, sem precisar desfazer nada manualmente (ver recomputarEstatisticasELista).
  await recomputarEstatisticasSeguro("reabrir lista");
  exibirSucesso("Lista reaberta!");
}

// Preferência (Configurações) de qual valor usar como estimativa ao adicionar um item numa lista:
// valor cadastrado no item, último valor comprado (qualquer local) ou o mais barato já registrado.
const OPCOES_VALOR_PROVISIONADO = [
  { valor: "ultimo", rotulo: "Último valor comprado" },
  { valor: "cadastro", rotulo: "Valor do cadastro" },
  { valor: "barato", rotulo: "Valor mais barato" },
];
function preferenciaValorProvisionado() {
  try { return localStorage.getItem("prefValorProvisionado") || "ultimo"; } catch { return "ultimo"; }
}
// Lista vertical de opção única (estilo rádio) — nunca mais de uma marcada ao mesmo tempo,
// já que a preferência é um único valor salvo (não um conjunto).
function renderOpcoesValorProvisionado() {
  const atual = preferenciaValorProvisionado();
  const container = $("#opcoes-valor-provisionado");
  container.innerHTML = OPCOES_VALOR_PROVISIONADO
    .map((o) => `<div class="detalhe-linha opcao-valor-prov" data-valor="${o.valor}">
      <span class="rotulo">${esc(o.rotulo)}</span>
      <span class="radio-marca ${o.valor === atual ? "selecionado" : ""}"></span>
    </div>`)
    .join("");
  container.querySelectorAll(".opcao-valor-prov").forEach((el) => {
    el.onclick = () => {
      try { localStorage.setItem("prefValorProvisionado", el.dataset.valor); } catch {}
      renderOpcoesValorProvisionado();
    };
  });
}
// Compara os dois registros de preço mais recentes (por data, ignorando valor zerado) pra saber
// se o item está "subindo" ou "caindo" — a linha-semente do cadastro (data "2000-01-01") entra
// na comparação como referência quando ainda não há 2 compras reais, então mesmo a primeira
// compra registrada já mostra a seta em relação ao valor do cadastro.
function tendenciaDeRegistros(registros) {
  const comValor = registros.filter((r) => (r.valor || 0) > 0).sort((a, b) => a.data.localeCompare(b.data));
  if (comValor.length < 2) return null;
  const atual = comValor[comValor.length - 1].valor;
  const anterior = comValor[comValor.length - 2].valor;
  if (atual === anterior) return null;
  return atual < anterior ? "queda" : "alta";
}
// Se nunca foi comprado (sem histórico), sempre fica em 0, independente da preferência.
// Igual a valorProvisionadoParaItem, mas também informa de onde o valor veio (cadastro, último
// comprado ou mais barato), quando vem de histórico em qual local, e a tendência (alta/queda) —
// usado no detalhe do item e na tela de Itens (seta ao lado do valor).
async function valorProvisionadoComOrigem(item) {
  const preferencia = preferenciaValorProvisionado();
  // Sempre busca o histórico (mesmo na preferência "cadastro") pois é dele que sai a tendência.
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "itens", item.id, "historicoPrecos"));
  const registros = snap.docs.map((d) => d.data());
  const tendencia = tendenciaDeRegistros(registros);
  if (preferencia === "cadastro") return { valor: item.valor || 0, origem: "cadastro", localId: item.localId || null, tendencia };
  // "Último comprado"/"mais barato" só valem quando já existe histórico de fato; sem nenhuma
  // compra finalizada ainda, sempre cai no valor do cadastro (ou 0, se também não tiver).
  if (snap.empty) return { valor: item.valor || 0, origem: "cadastro", localId: item.localId || null, tendencia };
  if (preferencia === "barato") {
    // A linha-semente do cadastro participa de propósito da disputa por "mais barato" (ver
    // comentário em confirmarFinalizar) — mas se for ela quem vence, mostra como "cadastro"
    // mesmo (sem local), já que não é uma compra de verdade.
    const comValor = registros.filter((r) => (r.valor || 0) > 0);
    if (!comValor.length) return { valor: item.valor || 0, origem: "cadastro", localId: item.localId || null, tendencia };
    const maisBarato = comValor.reduce((min, r) => (r.valor < min.valor ? r : min));
    if (maisBarato.origemCadastro) return { valor: maisBarato.valor, origem: "cadastro", localId: item.localId || null, tendencia };
    return { valor: maisBarato.valor, origem: "barato", localId: maisBarato.localId || null, tendencia };
  }
  // "Último comprado" só conta compra de fato — a linha-semente do cadastro nunca deve aparecer
  // como se fosse "a última compra" (ela não é uma compra real, é só o valor de cadastro
  // guardado como referência pra tendência e pro "mais barato").
  const comprasReais = registros.filter((r) => !r.origemCadastro);
  if (!comprasReais.length) return { valor: item.valor || 0, origem: "cadastro", localId: item.localId || null, tendencia };
  const maisRecente = comprasReais.sort((a, b) => b.data.localeCompare(a.data))[0];
  if (!maisRecente.valor) return { valor: item.valor || 0, origem: "cadastro", localId: item.localId || null, tendencia };
  return { valor: maisRecente.valor, origem: "ultimo", localId: maisRecente.localId || null, tendencia };
}
async function valorProvisionadoParaItem(item) {
  return (await valorProvisionadoComOrigem(item)).valor;
}
// Marcação da seta de tendência (▼ verde caindo, ▲ vermelha subindo) usada ao lado do valor.
// `discreta` deixa a seta ainda menor e mais apagada — usado no card da lista de compras, onde
// ela só compara o valor pago com o provisionado daquela compra específica.
function setaTendenciaHtml(tendencia, discreta) {
  const classe = `seta-tendencia${discreta ? " discreta" : ""}`;
  const titulo = discreta
    ? { queda: "Valor pago abaixo do provisionado", alta: "Valor pago acima do provisionado" }
    : { queda: "Valor em queda", alta: "Valor em alta" };
  if (tendencia === "queda") return `<span class="${classe} queda" title="${titulo.queda}">▼</span>`;
  if (tendencia === "alta") return `<span class="${classe} alta" title="${titulo.alta}">▲</span>`;
  return "";
}

// Avisa os demais membros do espaço compartilhado (nunca o próprio autor da ação) via o sino de notificações.
async function notificarMembrosEspaco(mensagem) {
  const membros = (espacoAtual.membros || []).filter((uid) => uid !== usuario.uid);
  if (membros.length === 0) return;
  const batch = writeBatch(bd);
  membros.forEach((uid) => {
    batch.set(doc(collection(bd, "notificacoes")), {
      tipo: "item_adicionado_lista", uidDestino: uid, espacoId: espacoIdAtual,
      mensagem, criadoEm: serverTimestamp(), lida: false,
    });
  });
  await batch.commit();
}

// "Finalizar compra" fica dentro do próprio cabeçalho da lista, numa faixa com linha tracejada
// (mesma linguagem visual do resumo Provisionado/Real/Diferença nos cards de lista já concluída)
// em vez de numa linha de botão separada — some enquanto o formulário de adicionar item está
// aberto, além das condições normais de exibição. O cabeçalho é recriado do zero a cada
// renderListaDetalhe(), então o botão (e seu onclick) precisam ser religados aqui toda vez.
function atualizarBtnFinalizarCompra() {
  const lista = listaAbertaAtual();
  const btn = $("#btn-finalizar-compra");
  const linha = btn?.closest(".lista-detalhe-finalizar");
  if (!btn || !linha) return;
  const formAberto = !$("#form-adicionar-item").classList.contains("hidden");
  const visivel = !!lista && lista.qtdItens > 0 && !lista.permanente && !lista.finalizadaEm && !formAberto;
  linha.classList.toggle("hidden", !visivel);
  // Só deixa clicar em "Finalizar compra" com pelo menos 1 item já marcado — finalizar uma lista
  // sem nada comprado não faz sentido (viraria uma compra "vazia" no histórico).
  if (lista) btn.disabled = !(lista.qtdComprados > 0);
  btn.onclick = abrirModalFinalizar;
}
function fecharFormAdicionarItem() {
  $("#ld-item-nome").value = "";
  $("#ld-item-id").value = "";
  $("#ld-unidade").value = "";
  $("#ld-quantidade").value = "1";
  configurarCampoQuantidade($("#ld-quantidade"), "");
  valorUnitarioAdicionarItem = 0;
  $("#ld-valor-provisionado").value = "";
  $("#ld-item-sugestoes").classList.add("hidden");
  $("#form-adicionar-item").classList.add("hidden");
  $("#btn-abrir-form-add-item").classList.remove("hidden");
  atualizarBtnFinalizarCompra();
}

async function adicionarItemNaLista() {
  const itemId = $("#ld-item-id").value;
  const item = itensAtuais.find((i) => i.id === itemId);
  if (!item) {
    exibirSucesso(itensAtuais.length === 0 ? "Cadastre um item antes de adicionar à lista." : "Digite o nome e selecione um item da lista de sugestões.");
    return;
  }
  // Não deixa duplicar o mesmo item na lista — se já estiver lá, manda direto pra edição de
  // quantidade dele em vez de criar uma segunda linha do mesmo produto.
  const jaNaLista = itensListaAtuais.find((i) => i.itemId === itemId);
  if (jaNaLista) {
    fecharFormAdicionarItem();
    exibirSucesso(`"${item.nome}" já está nesta lista — altere a quantidade em vez de adicionar de novo.`, 3000);
    abrirModalQuantidade(jaNaLista.id);
    return;
  }
  // Campo nativo type="number": .value já vem com ponto decimal (não vírgula), então lê direto
  // em vez de usar paraNumero (que espera o formato "R$ 1.234,56" dos campos de valor).
  let quantidade = Number($("#ld-quantidade").value) || 1;
  if (!unidadeAceitaFracao(item.unidade)) quantidade = Math.round(quantidade);
  try {
    const valorProvisionado = await valorProvisionadoParaItem(item);
    const adicionadoPorNome = nomeExibicaoUsuario();
    await addDoc(collection(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista"), {
      itemId, nome: item.nome, marca: item.marca || null, descricao: item.descricao || null,
      descricaoUnidade: item.descricaoUnidade || null, unidade: item.unidade, grupoNome: item.grupoNome || null,
      // "subtotalProvisionado" congela o valor esperado no momento em que o item entra na lista
      // (nunca é sobrescrito depois de comprado) — é contra ele que a "Diferença" do resumo da
      // compra finalizada compara o valor realmente pago, não contra o "subtotal" (que passa a
      // mostrar o valor pago assim que o item é marcado).
      quantidade, valorProvisionado, subtotal: quantidade * valorProvisionado, subtotalProvisionado: quantidade * valorProvisionado,
      comprado: false, localCompraId: null, valorPago: null, compradoPor: null, compradoEm: null,
      adicionadoPor: usuario.uid, adicionadoPorNome,
    });
    recalcularTotaisLista();
    const listaAtual = listaAbertaAtual();
    notificarMembrosEspaco(`${adicionadoPorNome} adicionou "${item.nome}" à lista "${listaAtual?.nome || ""}".`);
    fecharFormAdicionarItem();
    exibirSucesso("Item adicionado à lista!");
  } catch {
    exibirSucesso("Não foi possível adicionar o item. Confira a conexão e tente de novo.", 3000);
  }
}

// Busca os itens direto do servidor (getDocs) em vez de usar itensListaAtuais: logo após um
// addDoc/updateDoc/deleteDoc, o listener onSnapshot pode ainda não ter atualizado o cache local,
// e os totais ficariam errados se lêssemos o array em memória nesse instante.
// Conta "quantidade de itens" pela quantidade de cada linha só quando a unidade é contável
// (arroz em pacotes com quantidade 3 conta como 3 itens, não como 1 linha) — senão a contagem
// fica menor do que a real. Unidade fracionável (kg, g, ml, l) é sempre 1: é um produto só,
// só pesado/medido em vez de contado — 2kg de arroz não são "2 itens comprados".
function somaQuantidades(itens) {
  return itens.reduce((s, i) => s + (unidadeAceitaFracao(i.unidade) ? 1 : Math.max(1, Math.round(i.quantidade || 1))), 0);
}
async function recalcularTotaisLista(listaId = listaAbertaId) {
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", listaId, "itensLista"));
  const itens = snap.docs.map((d) => d.data());
  const qtdItens = somaQuantidades(itens);
  const qtdComprados = somaQuantidades(itens.filter((i) => i.comprado));
  // "valorProvisionadoTotal" é o progresso ao vivo (soma do "subtotal" de cada item — provisionado
  // enquanto pendente, real assim que comprado). "valorProvisionadoOriginalTotal" é o valor
  // esperado ORIGINAL, congelado por item em "subtotalProvisionado" no momento em que entrou na
  // lista — nunca muda depois, mesmo que o item seja comprado por um preço diferente. É contra
  // esse segundo campo que o resumo da compra finalizada compara o valor realmente pago.
  const valorProvisionadoTotal = itens.reduce((s, i) => s + (i.subtotal || 0), 0);
  // Itens adicionados antes de "subtotalProvisionado" existir não têm esse campo — cair pro
  // "subtotal" nesse caso seria errado (ele já virou o valor REAL pago assim que o item foi
  // comprado, ver confirmarCompra). Reconstrói o valor original a partir de "valorProvisionado"
  // (esse nunca é sobrescrito), que é exatamente a mesma conta que teria gerado o campo novo.
  const valorProvisionadoOriginalTotal = itens.reduce((s, i) => s + (i.subtotalProvisionado ?? (i.quantidade || 0) * (i.valorProvisionado || 0)), 0);
  const status = qtdComprados === 0 ? "pendente" : qtdComprados === qtdItens && qtdItens > 0 ? "comprada" : "parcial";
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaId), { qtdItens, qtdComprados, valorProvisionadoTotal, valorProvisionadoOriginalTotal, status });
}

/* ---------- alterar quantidade de um item na lista ---------- */
function abrirModalQuantidade(itemListaId) {
  const item = itensListaAtuais.find((i) => i.id === itemListaId);
  if (!item) return;
  itemListaPendenteId = itemListaId;
  $("#qtd-valor").value = item.quantidade;
  configurarCampoQuantidade($("#qtd-valor"), item.unidade);
  $("#qtd-label").textContent = `Quantidade${item.unidade ? ` (${item.unidade})` : ""} *`;
  mostrarMsg("#msg-quantidade", "", "");
  $("#overlay-quantidade").classList.remove("hidden");
}
function fecharModalQuantidade() {
  $("#overlay-quantidade").classList.add("hidden");
  itemListaPendenteId = null;
}
async function confirmarQuantidade() {
  const item = itensListaAtuais.find((i) => i.id === itemListaPendenteId);
  if (!item) return;
  let quantidade = Number($("#qtd-valor").value);
  if (!unidadeAceitaFracao(item.unidade)) quantidade = Math.round(quantidade);
  if (!quantidade || quantidade <= 0) {
    mostrarMsg("#msg-quantidade", "Informe uma quantidade válida.", "erro");
    return;
  }
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista", item.id), {
    quantidade, subtotal: quantidade * (item.valorProvisionado || 0), subtotalProvisionado: quantidade * (item.valorProvisionado || 0),
  });
  await recalcularTotaisLista();
  fecharModalQuantidade();
  exibirSucesso("Quantidade atualizada!");
}

/* ---------- trocar item de uma lista (substitui por outro do catálogo, mantendo a linha) ---------- */
function abrirModalTrocarItem(itemListaId) {
  const item = itensListaAtuais.find((i) => i.id === itemListaId);
  if (!item || item.comprado) return;
  itemListaTrocaId = itemListaId;
  $("#ti-item-nome").value = "";
  $("#ti-item-id").value = "";
  $("#ti-item-sugestoes").classList.add("hidden");
  $("#ti-item-sugestoes").innerHTML = "";
  mostrarMsg("#msg-trocar-item", "", "");
  $("#overlay-trocar-item").classList.remove("hidden");
  $("#ti-item-nome").focus();
}
function fecharModalTrocarItem() {
  $("#overlay-trocar-item").classList.add("hidden");
  itemListaTrocaId = null;
}
// Mesmo padrão de busca de renderSugestoesItemLista (inclusive o atalho "+ Cadastrar" quando não
// acha nada no catálogo), mas substituindo a linha na hora do clique numa sugestão, em vez de só
// preencher campos pra um "Adicionar" separado depois.
async function renderSugestoesTrocarItem(query) {
  const container = $("#ti-item-sugestoes");
  const termo = normalizarTexto(query);
  const encontrados = termo.length < 1 ? [] : itensAtuais.filter((i) => itemCombinaComBusca(i, termo)).slice(0, 6);
  if (termo.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  // Digitou algo e não achou nada no catálogo: mesmo atalho de cadastro rápido usado ao adicionar
  // item na lista — ao salvar, pergunta se quer trocar a linha original por esse item novo.
  if (encontrados.length === 0) {
    container.innerHTML = `<div class="autocomplete-item autocomplete-novo-item" id="ti-cadastrar-novo-item"><span class="nome">Item não encontrado</span><span class="valor">+ Cadastrar "${esc(query.trim())}"</span></div>`;
    container.classList.remove("hidden");
    $("#ti-cadastrar-novo-item").onclick = () => {
      const trocaId = itemListaTrocaId;
      fecharModalTrocarItem();
      abrirFormNovoItem();
      $("#fi-nome").value = query.trim();
      telaAnterior = "lista-detalhe";
      itemListaTrocaPendenteAoCadastrar = trocaId;
    };
    return;
  }
  container.innerHTML = encontrados
    .map((i) => {
      const detalhe = [i.marca, i.descricao, i.descricaoUnidade].filter(Boolean).join(" · ");
      return `<div class="autocomplete-item" data-id="${i.id}"><span class="nome">${esc(i.nome)}</span><span class="grupo">${esc(detalhe)}</span></div>`;
    })
    .join("");
  container.classList.remove("hidden");
  container.querySelectorAll(".autocomplete-item").forEach((el) => {
    el.onclick = () => {
      const item = itensAtuais.find((i) => i.id === el.dataset.id);
      if (item) confirmarTrocaItem(item);
    };
  });
}
async function confirmarTrocaItem(itemCatalogo) {
  const itemLista = itensListaAtuais.find((i) => i.id === itemListaTrocaId);
  if (!itemLista) return;
  if (itemCatalogo.id === itemLista.itemId) {
    fecharModalTrocarItem();
    return;
  }
  // Não deixa trocar pra um item que já está em outra linha dessa mesma lista — geraria duplicata.
  if (itensListaAtuais.some((i) => i.id !== itemLista.id && i.itemId === itemCatalogo.id)) {
    mostrarMsg("#msg-trocar-item", `"${itemCatalogo.nome}" já está nesta lista.`, "erro");
    return;
  }
  let quantidade = itemLista.quantidade || 1;
  if (!unidadeAceitaFracao(itemCatalogo.unidade)) quantidade = Math.round(quantidade) || 1;
  try {
    const valorProvisionado = await valorProvisionadoParaItem(itemCatalogo);
    await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista", itemLista.id), {
      itemId: itemCatalogo.id, nome: itemCatalogo.nome, marca: itemCatalogo.marca || null,
      descricao: itemCatalogo.descricao || null, descricaoUnidade: itemCatalogo.descricaoUnidade || null,
      unidade: itemCatalogo.unidade, grupoNome: itemCatalogo.grupoNome || null,
      quantidade, valorProvisionado, subtotal: quantidade * valorProvisionado, subtotalProvisionado: quantidade * valorProvisionado,
    });
    await recalcularTotaisLista();
    fecharModalTrocarItem();
    exibirSucesso(`Item trocado para "${itemCatalogo.nome}"!`);
  } catch {
    mostrarMsg("#msg-trocar-item", "Não foi possível trocar o item. Confira a conexão e tente de novo.", "erro");
  }
}

/* ---------- marcar item como comprado (modal local + valor) ---------- */
// Ranking de locais mais usados (mesma contagem já usada no dashboard "Locais mais utilizados"),
// carregado ao abrir a lista pra sugerir um local antes mesmo de marcar o primeiro item.
async function carregarLocalMaisUsado() {
  try {
    const snap = await getDoc(doc(bd, "espacos", espacoIdAtual, "estatisticas", "geral"));
    const locais = snap.exists() ? snap.data().locais || {} : {};
    const entradas = Object.entries(locais).sort((a, b) => b[1] - a[1]);
    localMaisUsadoId = entradas.length ? entradas[0][0] : null;
  } catch {
    localMaisUsadoId = null;
  }
}
// Compara o que está sendo digitado em "Valor pago" com o último valor considerado (mostrado
// acima) e atualiza a setinha ao vivo: verde/para baixo se ficou mais barato, vermelha/pra cima
// se ficou mais caro — some se não há referência ainda ou o valor bate exatamente.
function atualizarDiferencaValorComprar() {
  const el = $("#mc-valor-diferenca");
  if (!el) return;
  const atual = paraNumero($("#mc-valor").value);
  const diferenca = valorReferenciaModalComprar > 0 && atual > 0
    ? Math.round((atual - valorReferenciaModalComprar) * 100) / 100
    : 0;
  if (!diferenca) {
    el.className = "mc-valor-diferenca";
    el.innerHTML = "";
    return;
  }
  const tendencia = diferenca < 0 ? "queda" : "alta";
  el.className = `mc-valor-diferenca ${tendencia}`;
  el.innerHTML = `${setaTendenciaHtml(tendencia)} ${diferenca < 0 ? "−" : "+"}${formatarMoeda(Math.abs(diferenca))} em relação ao último valor`;
}
// "Valor pago" é sempre por unidade — com mais de 1 unidade nessa linha, deixa claro quanto isso
// dá no total (provisionado ao abrir o modal, e ao vivo conforme o valor digitado muda), já que
// o total só aparece de novo depois de confirmar a compra.
function atualizarLegendaValorTotalComprar() {
  const el = $("#mc-valor-total");
  if (!el) return;
  const item = itensListaAtuais.find((i) => i.id === itemListaPendenteId);
  if (!item) {
    el.textContent = "";
    return;
  }
  const fracionavel = unidadeAceitaFracao(item.unidade);
  const quantidade = fracionavel ? Number($("#mc-quantidade").value) || 0 : item.quantidade || 0;
  if (!(quantidade > 1)) {
    el.textContent = "";
    return;
  }
  const valor = paraNumero($("#mc-valor").value);
  const numero = quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  el.textContent = `Total para ${numero}${item.unidade ? ` ${abreviarUnidade(item.unidade)}` : ""}: ${formatarMoeda(quantidade * valor)}`;
}
async function abrirModalComprar(itemListaId) {
  itemListaPendenteId = itemListaId;
  const item = itensListaAtuais.find((i) => i.id === itemListaId);
  if (!item) return;
  valorReferenciaModalComprar = 0;
  // Nome/marca/descrição já vêm copiados pro itensLista desde que o item foi adicionado à
  // lista — não precisa buscar o cadastro pra mostrar esses detalhes aqui. A referência de valor
  // (passado) fica junto desse bloco, separada dos campos "Local"/"Valor pago" (a compra atual).
  const partes = [item.marca, item.descricao, item.descricaoUnidade].filter(Boolean);
  const detalhe = partes.map((p) => esc(p)).join(" · ");
  $("#mc-item-info").innerHTML =
    `<div class="nome">${esc(item.nome)}</div>` +
    (detalhe ? `<div class="detalhe detalhe-truncado">${detalhe}</div>` : "") +
    `<div id="mc-valor-referencia" class="mc-valor-referencia">Buscando último valor...</div>`;

  // Unidades fracionáveis (kg, g, ml, l) costumam ter o peso real definido só na balança do
  // mercado — em vez de fazer a conta de cabeça, deixa informar a quantidade separadamente.
  const fracionavel = unidadeAceitaFracao(item.unidade);
  $("#campo-mc-quantidade").classList.toggle("hidden", !fracionavel);
  if (fracionavel) {
    $("#mc-unidade-label").textContent = item.unidade || "";
    $("#mc-quantidade").value = item.quantidade || "";
  }
  // "Valor pago" é sempre o preço por unidade (R$/kg, R$/un...), nunca o total da linha — o
  // total (subtotal) é sempre calculado como quantidade × esse valor, em confirmarCompra.
  // Pré-preenche com o que já estava provisionado na lista enquanto busca a origem detalhada
  // (cadastro, último comprado ou mais barato + local) pra completar a referência acima.
  $("#rotulo-mc-valor").textContent = `Valor pago (por ${abreviarUnidade(item.unidade)}) *`;
  $("#mc-valor").value = item.valorProvisionado ? formatarMoeda(item.valorProvisionado) : "";
  atualizarDiferencaValorComprar();
  atualizarLegendaValorTotalComprar();
  // Sugere o local mais usado até alguém marcar o primeiro item da sessão; a partir daí, segue
  // lembrando o último local escolhido (só falta informar o valor a cada item seguinte).
  const localSugerido = ultimoLocalUsadoId || localMaisUsadoId;
  if (localSugerido) $("#mc-local").value = localSugerido;
  mostrarMsg("#msg-comprar", "", "");
  $("#overlay-comprar").classList.remove("hidden");

  const catalogo = itensAtuais.find((c) => c.id === item.itemId);
  const origemValor = catalogo ? await valorProvisionadoComOrigem(catalogo) : null;
  // Se enquanto buscava o usuário fechou o modal ou abriu o de outro item, descarta o resultado.
  if (itemListaPendenteId !== itemListaId) return;
  const referenciaEl = $("#mc-valor-referencia");
  if (!origemValor) {
    if (referenciaEl) referenciaEl.textContent = "";
    return;
  }
  valorReferenciaModalComprar = origemValor.valor || 0;
  $("#mc-valor").value = origemValor.valor ? formatarMoeda(origemValor.valor) : "";
  atualizarDiferencaValorComprar();
  atualizarLegendaValorTotalComprar();
  // Mesma flag azul usada no Detalhes/Histórico do item: mostra "Cadastro" quando o valor não tem
  // um local real por trás (local do cadastro ainda em "Não informado"), senão o nome do local de
  // onde esse valor veio de fato.
  const nomeLocal = origemValor.localId ? locaisAtuais.find((l) => l.id === origemValor.localId)?.nome : null;
  const textoFlag = nomeLocal && normalizarTexto(nomeLocal) !== normalizarTexto(NOME_LOCAL_NAO_INFORMADO) ? nomeLocal : "Cadastro";
  if (referenciaEl) referenciaEl.innerHTML = `<span>Último valor:</span> <span class="badge-mini">${esc(textoFlag)}</span> <span>${esc(formatarMoeda(origemValor.valor))}</span>`;
}
function fecharModalComprar() {
  $("#overlay-comprar").classList.add("hidden");
  itemListaPendenteId = null;
}
async function confirmarCompra() {
  const localId = $("#mc-local").value;
  // "Valor pago" é sempre por unidade (mesma unidade do "R$/kg" mostrado no card) — o total da
  // linha (subtotal) é sempre esse valor × a quantidade, nunca o valor digitado direto.
  const valorPago = paraNumero($("#mc-valor").value);
  if (!localId || valorPago <= 0) {
    mostrarMsg("#msg-comprar", "Selecione o local e informe o valor pago.", "erro");
    return;
  }
  const item = itensListaAtuais.find((i) => i.id === itemListaPendenteId);
  if (!item) return;
  // Em unidades fracionáveis, a quantidade real (peso na balança) pode ter sido ajustada no
  // campo "Quantidade comprada" — usa ela pro total em vez da quantidade só estimada da lista.
  const fracionavel = unidadeAceitaFracao(item.unidade);
  const quantidade = fracionavel ? (Number($("#mc-quantidade").value) || item.quantidade || 0) : (item.quantidade || 0);
  ultimoLocalUsadoId = localId;
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista", item.id), {
    comprado: true, localCompraId: localId, valorPago, compradoPor: usuario.uid, compradoEm: hojeISO(),
    subtotal: quantidade * valorPago,
  });
  // Histórico de preços e estatísticas dos dashboards só são gravados na finalização da compra
  // (confirmarFinalizar), não aqui: até lá o check é só o estado "peguei no carrinho", podendo
  // ser desmarcado sem deixar rastro nem inflar "itens/grupos/locais mais usados" à toa.
  await recalcularTotaisLista();
  fecharModalComprar();
  exibirSucesso("Item marcado como comprado!");
}
async function desmarcarComprado(item) {
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista", item.id), {
    comprado: false, localCompraId: null, valorPago: null, compradoPor: null, compradoEm: null,
    // Volta o card a mostrar o total provisionado (não o que tinha sido pago) agora que o item
    // está pendente de novo.
    subtotal: (item.quantidade || 0) * (item.valorProvisionado || 0),
  });
  recalcularTotaisLista();
}

/* ---------- finalizar compra ---------- */
// Total real da compra: soma do "subtotal" já calculado de cada item comprado (quantidade real ×
// valor pago, ver confirmarCompra), nunca o valor provisionado dos itens ainda pendentes — por
// isso o campo é travado. Usa o "subtotal" já pronto (não recalcula quantidade × valorPago aqui)
// pra bater exatamente com o total mostrado no topo da tela da lista, que soma o mesmo campo.
function calcularTotalItensComprados(itens) {
  return itens.filter((i) => i.comprado).reduce((s, i) => s + (i.subtotal || 0), 0);
}
let totalItensComprasFinalizar = 0;
let valorFinalFinalizar = 0;
// Pagamento pode ser dividido em mais de uma forma (ex.: parte no PIX, parte no cartão de
// crédito parcelado) — cada linha guarda sua própria forma, valor e parcelas (só relevante pra
// Cartão de Crédito). `id` é só uma chave local pra achar a linha certa nos handlers, não é
// salvo em lugar nenhum.
let pagamentosFinalizar = [];
let proximoIdPagamentoFinalizar = 1;
function novaLinhaPagamento(formaId, valorTexto) {
  return { id: proximoIdPagamentoFinalizar++, formaId: formaId || "", valorTexto: valorTexto || "", parcelas: 1 };
}
function totalAlocadoPagamentos() {
  return pagamentosFinalizar.reduce((s, p) => s + (paraNumero(p.valorTexto) || 0), 0);
}
// Mostra quanto ainda falta (ou sobra) alocar entre as formas de pagamento em relação ao valor
// final — chamado a cada edição de valor, sem re-renderizar as linhas (evita perder o foco de
// quem está digitando).
function atualizarRestantePagamentos() {
  const el = $("#fin-restante-pagamentos");
  if (!el) return;
  const restante = Math.round((valorFinalFinalizar - totalAlocadoPagamentos()) * 100) / 100;
  if (Math.abs(restante) < 0.005) {
    el.className = "mc-valor-diferenca queda";
    el.textContent = "Os valores batem com o total final.";
    return;
  }
  el.className = `mc-valor-diferenca ${restante > 0 ? "alta" : "queda"}`;
  el.textContent = restante > 0
    ? `Falta alocar ${formatarMoeda(restante)}`
    : `${formatarMoeda(Math.abs(restante))} a mais do que o total final`;
}
function renderPagamentosFinalizar() {
  const container = $("#fin-pagamentos");
  container.innerHTML = pagamentosFinalizar
    .map((p) => {
      const forma = formasAtuais.find((f) => f.id === p.formaId);
      const ehCredito = forma?.nome === "Cartão de Crédito";
      return `<div class="linha-pagamento" data-id="${p.id}">
        ${pagamentosFinalizar.length > 1 ? `<button type="button" class="btn-remover-pagamento" data-id="${p.id}" aria-label="Remover esta forma de pagamento">✕</button>` : ""}
        <div class="linha-dupla">
          <div class="field">
            <label>Forma de pagamento *</label>
            <select class="pg-forma" data-id="${p.id}">
              <option value="">Selecione...</option>
              ${formasAtuais.map((f) => `<option value="${f.id}" ${f.id === p.formaId ? "selected" : ""}>${esc(f.nome)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Valor *</label>
            <input type="text" class="pg-valor" data-id="${p.id}" inputmode="decimal" placeholder="0,00" value="${esc(p.valorTexto)}">
          </div>
        </div>
        ${ehCredito ? `<div class="field">
          <label>Parcelas</label>
          <div class="stepper-quantidade">
            <button type="button" class="btn-stepper pg-parcela-menos" data-id="${p.id}" aria-label="Diminuir parcelas">−</button>
            <input type="number" class="pg-parcelas" data-id="${p.id}" min="1" step="1" value="${p.parcelas}">
            <button type="button" class="btn-stepper pg-parcela-mais" data-id="${p.id}" aria-label="Aumentar parcelas">+</button>
          </div>
        </div>` : ""}
      </div>`;
    })
    .join("");

  container.querySelectorAll(".pg-forma").forEach((el) => {
    el.onchange = () => {
      const p = pagamentosFinalizar.find((x) => x.id === Number(el.dataset.id));
      p.formaId = el.value;
      renderPagamentosFinalizar();
      atualizarRestantePagamentos();
    };
  });
  container.querySelectorAll(".pg-valor").forEach((el) => {
    aplicarMascaraMoeda(el);
    el.addEventListener("input", () => {
      const p = pagamentosFinalizar.find((x) => x.id === Number(el.dataset.id));
      // Trava o valor no máximo que ainda cabe (valor final menos o que já foi alocado nas
      // outras linhas) — ex.: total R$800, já R$500 alocados em outra forma, esta linha não
      // deixa passar de R$300, em vez de só avisar depois que a soma não bate.
      const alocadoNasOutras = pagamentosFinalizar
        .filter((x) => x.id !== p.id)
        .reduce((s, x) => s + (paraNumero(x.valorTexto) || 0), 0);
      const maximoPermitido = Math.max(Math.round((valorFinalFinalizar - alocadoNasOutras) * 100) / 100, 0);
      const digitado = paraNumero(el.value) || 0;
      if (digitado > maximoPermitido + 0.001) {
        el.value = maximoPermitido > 0 ? formatarMoeda(maximoPermitido) : "";
      }
      p.valorTexto = el.value;
      atualizarRestantePagamentos();
    });
  });
  container.querySelectorAll(".pg-parcelas").forEach((el) => {
    el.addEventListener("keydown", (e) => { if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault(); });
    el.addEventListener("input", () => {
      const p = pagamentosFinalizar.find((x) => x.id === Number(el.dataset.id));
      p.parcelas = Math.max(1, Number(el.value) || 1);
    });
  });
  container.querySelectorAll(".pg-parcela-menos, .pg-parcela-mais").forEach((btn) => {
    btn.onclick = () => {
      const p = pagamentosFinalizar.find((x) => x.id === Number(btn.dataset.id));
      p.parcelas = Math.max(1, p.parcelas + (btn.classList.contains("pg-parcela-mais") ? 1 : -1));
      const input = container.querySelector(`.pg-parcelas[data-id="${btn.dataset.id}"]`);
      if (input) input.value = p.parcelas;
    };
  });
  container.querySelectorAll(".btn-remover-pagamento").forEach((btn) => {
    btn.onclick = () => {
      pagamentosFinalizar = pagamentosFinalizar.filter((x) => x.id !== Number(btn.dataset.id));
      renderPagamentosFinalizar();
      atualizarRestantePagamentos();
    };
  });
}
// Desconto abate do total dos itens comprados — nunca deixa o valor final ficar negativo.
function atualizarValorFinalFinalizar() {
  const desconto = Math.min(Math.max(paraNumero($("#fin-desconto").value), 0), totalItensComprasFinalizar);
  valorFinalFinalizar = Math.round((totalItensComprasFinalizar - desconto) * 100) / 100;
  $("#fin-valor-final").value = formatarMoeda(valorFinalFinalizar);
  atualizarRestantePagamentos();
}
function abrirModalFinalizar() {
  const lista = listaAbertaAtual();
  totalItensComprasFinalizar = calcularTotalItensComprados(itensListaAtuais);
  $("#fin-valor-total").value = formatarMoeda(totalItensComprasFinalizar);
  $("#fin-desconto").value = "";
  valorFinalFinalizar = totalItensComprasFinalizar;
  $("#fin-valor-final").value = formatarMoeda(valorFinalFinalizar);
  // Começa com uma única linha já preenchida com o valor final — quem só usa uma forma de
  // pagamento (o caso mais comum) não precisa mexer em nada além de escolher a forma.
  pagamentosFinalizar = [novaLinhaPagamento("", valorFinalFinalizar ? formatarMoeda(valorFinalFinalizar) : "")];
  renderPagamentosFinalizar();
  atualizarRestantePagamentos();
  mostrarMsg("#msg-finalizar", "", "");
  const pendentes = lista ? lista.qtdItens - lista.qtdComprados : 0;
  mostrarMsg(
    "#aviso-pendentes-finalizar",
    pendentes > 0 ? `Ainda ${pendentes === 1 ? "falta 1 item" : `faltam ${pendentes} itens`} pegar nesta lista. Você pode finalizar mesmo assim — quem ficar pendente mantém o último histórico de preço registrado.` : "",
    ""
  );
  $("#overlay-finalizar").classList.remove("hidden");
}
function fecharModalFinalizar() {
  $("#overlay-finalizar").classList.add("hidden");
}
async function confirmarFinalizar() {
  if (pagamentosFinalizar.some((p) => !p.formaId)) {
    mostrarMsg("#msg-finalizar", "Selecione a forma de pagamento em todas as linhas.", "erro");
    return;
  }
  if (pagamentosFinalizar.some((p) => !(paraNumero(p.valorTexto) > 0))) {
    mostrarMsg("#msg-finalizar", "Informe um valor maior que zero em todas as formas de pagamento.", "erro");
    return;
  }
  const restante = Math.round((valorFinalFinalizar - totalAlocadoPagamentos()) * 100) / 100;
  if (Math.abs(restante) >= 0.01) {
    mostrarMsg("#msg-finalizar", "A soma das formas de pagamento precisa bater com o valor final a pagar.", "erro");
    return;
  }
  // Grava o histórico de preços agora (não no check individual): só os itens efetivamente
  // marcados como comprados entram; os pendentes simplesmente mantêm o histórico anterior.
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista"));
  const todosItens = snap.docs.map((d) => d.data());
  const totalItens = calcularTotalItensComprados(todosItens);
  if (totalItens <= 0) {
    mostrarMsg("#msg-finalizar", "Nenhum item foi marcado como comprado ainda.", "erro");
    return;
  }
  // Desconto é do fechamento da compra inteira (cupom, promoção do caixa...), não de um item
  // específico — por isso só abate do total final, sem mexer no histórico de preço por item.
  const desconto = Math.min(Math.max(paraNumero($("#fin-desconto").value), 0), totalItens);
  const valorTotalPago = totalItens - desconto;
  if (!confirm("Deseja realmente finalizar esta compra?")) return;
  const pagamentos = pagamentosFinalizar.map((p) => {
    const forma = formasAtuais.find((f) => f.id === p.formaId);
    return {
      formaPagamentoId: p.formaId,
      valor: Math.round(paraNumero(p.valorTexto) * 100) / 100,
      parcelas: forma?.nome === "Cartão de Crédito" ? Math.max(1, Number(p.parcelas) || 1) : 1,
    };
  });
  const comprados = todosItens.filter((i) => i.comprado && i.valorPago > 0 && i.localCompraId);
  // Se esta é a primeira compra já registrada do item, preserva o valor do cadastro como um
  // registro a mais no histórico (com data bem antiga, pra nunca ser confundido com "o último
  // comprado") — assim ele continua entrando nas comparações de "mais barato" mesmo depois que
  // o histórico real começar a se acumular, em vez de sumir de vista depois da 1ª compra.
  const historicosVazios = await Promise.all(comprados.map(async (i) => {
    const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "itens", i.itemId, "historicoPrecos"));
    return snap.empty;
  }));
  await Promise.all(comprados.flatMap((i, idx) => {
    const gravacoes = [addDoc(collection(bd, "espacos", espacoIdAtual, "itens", i.itemId, "historicoPrecos"), {
      localId: i.localCompraId, valor: i.valorPago, data: i.compradoEm || hojeISO(), listaId: listaAbertaId,
    })];
    if (historicosVazios[idx]) {
      const itemCadastro = itensAtuais.find((it) => it.id === i.itemId);
      gravacoes.push(addDoc(collection(bd, "espacos", espacoIdAtual, "itens", i.itemId, "historicoPrecos"), {
        localId: itemCadastro?.localId || null, valor: itemCadastro?.valor || 0, data: "2000-01-01", listaId: null, origemCadastro: true,
      }));
    }
    return gravacoes;
  }));
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId), {
    finalizadaEm: serverTimestamp(), pagamentos, valorTotalPago, desconto,
  });
  // Recalcula "estatisticas/geral" e o provisionado de cada lista finalizada do zero (nunca por
  // increment) — ver recomputarEstatisticasELista.
  await recomputarEstatisticasSeguro("finalizar compra");
  fecharModalFinalizar();
  exibirSucesso("Compra finalizada!");
  irParaTela("listas");
}

/* ---------- cadastro: itens do catálogo ---------- */
function renderChipsFiltroGrupo() {
  const nomes = gruposAtuais.map((g) => g.nome);
  renderChips("#filtros-itens-grupo", nomes, filtroGrupoItens, (v) => { filtroGrupoItens = v; renderCadastroItens(); });
}
function renderChipsFiltroLocal() { /* usado dentro de renderListaDetalhe */ }

async function renderCadastroItens() {
  renderChipsFiltroGrupo();
  const termo = normalizarTexto(termoBuscaCadastro.itens);
  let lista = itensAtuais;
  // Buscando, ignora o filtro de grupo selecionado — o item pesquisado pode estar em qualquer
  // grupo, e limitar à aba "Todos" implicitamente é mais previsível do que manter o recorte.
  if (termo) lista = lista.filter((i) => itemCombinaComBusca(i, termo));
  else if (filtroGrupoItens) lista = lista.filter((i) => i.grupoNome === filtroGrupoItens);
  $("#total-itens").textContent = `${lista.length} ${lista.length === 1 ? "Item" : "Itens"}`;
  const container = $("#lista-cadastro-itens");
  if (lista.length === 0) {
    container.innerHTML = `<div class="vazio">${termo ? "Nenhum item encontrado." : "Nenhum item cadastrado."}</div>`;
    return;
  }
  // Mesma regra de preferência (Configurações) usada ao adicionar o item numa lista: valor do
  // cadastro, último valor comprado ou o mais barato — sem histórico, sempre cai no cadastro.
  // A seta ao lado reflete a tendência do histórico de preços do item (subindo ou caindo).
  const valores = await Promise.all(lista.map((i) => valorProvisionadoComOrigem(i)));
  container.innerHTML = lista
    .map((i, idx) => {
      const partes = [i.marca, i.descricao, i.descricaoUnidade].filter(Boolean);
      const detalhe = partes.map((p) => esc(p)).join(" · ");
      return `<div class="item" data-id="${i.id}">
      <div class="info">
        <div class="nome">${esc(i.nome)}</div>
        <div class="detalhe detalhe-truncado">${detalhe}</div>
      </div>
      <span class="valor">${formatarMoeda(valores[idx].valor)}${setaTendenciaHtml(valores[idx].tendencia)}</span>
      <button class="btn-enviar-lista" data-id-enviar="${i.id}" aria-label="Enviar para lista pendente" title="Enviar para lista pendente">🛒</button>
    </div>`;
    })
    .join("");
  container.querySelectorAll(".item").forEach((el) => {
    el.onclick = () => abrirItemDetalhe(itensAtuais.find((i) => i.id === el.dataset.id));
  });
  container.querySelectorAll(".btn-enviar-lista").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      abrirPickerEnviarLista(itensAtuais.find((i) => i.id === btn.dataset.idEnviar));
    };
  });
}

// Picker de "enviar item direto para uma lista pendente" a partir do catálogo (tela Itens) —
// sempre pergunta qual lista quando há mais de uma pendente, nunca escolhe uma automaticamente.
// Listas que já têm esse item ficam desabilitadas (não permite duplicar o item na mesma lista).
// A pessoa escolhe clicando (só destaca, não envia na hora) e confirma no botão "Confirmar".
let itemParaEnviarAtual = null;
let listaEnviarSelecionadaId = null;
async function abrirPickerEnviarLista(item) {
  if (!item) return;
  itemParaEnviarAtual = item;
  listaEnviarSelecionadaId = null;
  $("#titulo-enviar-lista").textContent = `Enviar "${item.nome}" para qual lista?`;
  $("#env-quantidade").value = "1";
  configurarCampoQuantidade($("#env-quantidade"), item.unidade);
  $("#btn-confirmar-enviar-lista").classList.add("hidden");
  // Mais recente primeiro na ordem de exibição não importa aqui — só precisamos saber qual é a
  // última criada, pra vir pré-selecionada quando houver mais de uma disponível.
  const pendentes = [...listasAtuais.filter((l) => !l.finalizadaEm)]
    .sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
  const container = $("#lista-opcoes-enviar");
  mostrarMsg("#msg-enviar-lista", "", "");
  if (pendentes.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhuma lista pendente. Crie uma lista primeiro.</div>`;
    $("#overlay-enviar-lista").classList.remove("hidden");
    return;
  }
  container.innerHTML = `<div class="vazio">Verificando listas...</div>`;
  $("#overlay-enviar-lista").classList.remove("hidden");
  const jaNaLista = await Promise.all(pendentes.map(async (l) => {
    const snap = await getDocs(query(collection(bd, "espacos", espacoIdAtual, "listas", l.id, "itensLista"), where("itemId", "==", item.id)));
    return !snap.empty;
  }));
  const disponiveis = pendentes.filter((l, idx) => !jaNaLista[idx]);
  listaEnviarSelecionadaId = disponiveis.length ? disponiveis[disponiveis.length - 1].id : null;
  renderOpcoesListaEnviar(pendentes, jaNaLista);
}
function renderOpcoesListaEnviar(pendentes, jaNaLista) {
  const container = $("#lista-opcoes-enviar");
  container.innerHTML = pendentes
    .map((l, idx) => jaNaLista[idx]
      ? `<button type="button" class="btn-secundario opcao-lista-enviar" data-lista-id="${l.id}" disabled style="width:100%;margin-bottom:8px;text-align:left;opacity:.5;cursor:not-allowed">${esc(itemParaEnviarAtual?.nome)} já está na lista "${esc(l.nome)}"</button>`
      : `<button type="button" class="btn-secundario opcao-lista-enviar ${l.id === listaEnviarSelecionadaId ? "selecionada" : ""}" data-lista-id="${l.id}" style="width:100%;margin-bottom:8px;text-align:left">${esc(l.nome)}</button>`)
    .join("");
  container.querySelectorAll(".opcao-lista-enviar:not([disabled])").forEach((btn) => {
    btn.onclick = () => {
      listaEnviarSelecionadaId = btn.dataset.listaId;
      renderOpcoesListaEnviar(pendentes, jaNaLista);
    };
  });
  $("#btn-confirmar-enviar-lista").classList.toggle("hidden", !listaEnviarSelecionadaId);
}
function fecharPickerEnviarLista() {
  $("#overlay-enviar-lista").classList.add("hidden");
  mostrarMsg("#msg-enviar-lista", "", "");
  itemParaEnviarAtual = null;
  listaEnviarSelecionadaId = null;
}
async function confirmarEnvioParaLista() {
  if (!itemParaEnviarAtual || !listaEnviarSelecionadaId) return;
  const item = itemParaEnviarAtual;
  const listaId = listaEnviarSelecionadaId;
  // Checagem de segurança contra corrida (ex: enviado por outro dispositivo entre abrir o picker e confirmar).
  const jaExiste = await getDocs(query(collection(bd, "espacos", espacoIdAtual, "listas", listaId, "itensLista"), where("itemId", "==", item.id)));
  if (!jaExiste.empty) {
    const nomeLista = listasAtuais.find((l) => l.id === listaId)?.nome || "";
    mostrarMsg("#msg-enviar-lista", `${item.nome} já está na lista "${nomeLista}".`, "erro");
    return;
  }
  let quantidade = Number($("#env-quantidade").value) || 1;
  if (!unidadeAceitaFracao(item.unidade)) quantidade = Math.round(quantidade);
  const adicionadoPorNome = nomeExibicaoUsuario();
  const valorProvisionado = await valorProvisionadoParaItem(item);
  await addDoc(collection(bd, "espacos", espacoIdAtual, "listas", listaId, "itensLista"), {
    itemId: item.id, nome: item.nome, marca: item.marca || null, descricao: item.descricao || null,
    descricaoUnidade: item.descricaoUnidade || null, unidade: item.unidade, grupoNome: item.grupoNome || null,
    quantidade, valorProvisionado, subtotal: quantidade * valorProvisionado, subtotalProvisionado: quantidade * valorProvisionado,
    comprado: false, localCompraId: null, valorPago: null, compradoPor: null, compradoEm: null,
    adicionadoPor: usuario.uid, adicionadoPorNome,
  });
  await recalcularTotaisLista(listaId);
  const nomeLista = listasAtuais.find((l) => l.id === listaId)?.nome || "";
  notificarMembrosEspaco(`${adicionadoPorNome} adicionou "${item.nome}" à lista "${nomeLista}".`);
  fecharPickerEnviarLista();
  exibirSucesso("Item enviado para a lista!");
}

function renderImagemItemDetalhe(fotoUrl) {
  $("#det-foto-preview").innerHTML = fotoUrl ? `<img src="${fotoUrl}" alt="Foto do item">` : "📷";
  $("#btn-remover-foto-det").classList.toggle("hidden", !fotoUrl);
}
async function salvarFotoItemDetalhe(arquivo, labelId) {
  if (!itemCatalogoAbertoId) return;
  const label = $(labelId);
  const textoOriginal = label.textContent;
  label.textContent = "Enviando...";
  try {
    // A pré-visualização do item nunca passa de 140px na tela (item-foto-preview-grande) — 320px
    // já cobre até telas de alta densidade sem carregar peso à toa; sem Storage no projeto, a foto
    // vira base64 dentro do próprio documento do Firestore, então cada KB economizado importa.
    const dataUrl = await redimensionarImagem(arquivo, 320, 0.65);
    await updateDoc(doc(bd, "espacos", espacoIdAtual, "itens", itemCatalogoAbertoId), { fotoUrl: dataUrl });
    renderImagemItemDetalhe(dataUrl);
  } catch {
    mostrarMsg("#msg-form-item", "Não foi possível enviar a foto. Tente novamente.", "erro");
  }
  label.textContent = textoOriginal;
}

async function abrirItemDetalhe(item, origemTela) {
  itemCatalogoAbertoId = item.id;
  telaAnterior = origemTela || "cadastro-itens";
  $(".tab[data-tab='cadastro']").click();

  // "Valor" já sai dinâmico direto — conforme a preferência (Configurações) e o histórico de
  // preços atualizado a cada compra, em vez de mostrar sempre o número fixo do cadastro. A linha
  // "Local" logo abaixo mostra de onde esse valor veio (substitui a antiga linha "Comprado em") —
  // "Local" do cadastro do item em si não aparece mais fora daqui, só no Histórico.
  const origemValor = await valorProvisionadoComOrigem(item);
  const nomeLocalValor = origemValor.localId ? locaisAtuais.find((l) => l.id === origemValor.localId)?.nome : null;
  const linhaValor = `<div class="detalhe-bloco-valor">
    <div class="detalhe-linha detalhe-linha-valor">
      <span class="rotulo">Valor</span>
      <span class="valor-detalhe"><strong>${esc(formatarMoeda(origemValor.valor))}</strong></span>
    </div>
    <div class="detalhe-linha detalhe-linha-valor">
      <span class="rotulo">Local</span>
      <span class="valor-detalhe">${nomeLocalValor ? `<span class="badge-mini">${esc(nomeLocalValor)}</span>` : "—"}</span>
    </div>
    <p class="detalhe-valor-aviso">Valor e local são dinâmicos, atualizados a cada compra.</p>
  </div>`;

  $("#item-detalhe-info").innerHTML =
    [
      ["Nome", item.nome],
      ["Marca", item.marca || "—"],
      ["Descrição", item.descricao || "—"],
      ["Unidade", item.unidade],
      ["Descrição da unidade", item.descricaoUnidade || "—"],
      ["Grupo", item.grupoNome || "—"],
    ].map(([r, v]) => `<div class="detalhe-linha"><span class="rotulo">${esc(r)}</span><span class="valor-detalhe">${esc(String(v))}</span></div>`).join("") +
    linhaValor +
    `<button class="btn-secundario" id="btn-editar-item-catalogo" style="margin-top:14px">✏️ Editar item</button>`;
  $("#btn-editar-item-catalogo").onclick = () => abrirFormEditarItem(item);
  renderImagemItemDetalhe(item.fotoUrl || null);

  await renderHistoricoItem(item);

  mostrarTelaCheia("item-detalhe", item.nome);
}

// Um item só tem "compra registrada de verdade" quando existe algum histórico que não seja a
// linha-semente do cadastro (origemCadastro) — usado pra travar o campo "Valor" do formulário.
async function itemTemCompraRegistrada(itemId) {
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "itens", itemId, "historicoPrecos"));
  return snap.docs.some((d) => !d.data().origemCadastro);
}
// Exibida na aba "Histórico de Preços" do item: reduzida a 1 linha por local (a mais
// recente), mas o botão de excluir apaga TODOS os registros daquele item+local — senão o
// registro mais antigo simplesmente reapareceria no lugar do que acabou de ser removido.
async function renderHistoricoItem(item) {
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "itens", item.id, "historicoPrecos"));
  historicoAtual = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Dashboards e listagens sempre usam o último valor informado por local — se o mesmo item foi
  // comprado 2x no mesmo local com valores diferentes, só o mais recente conta na comparação.
  const ultimos = ultimosPorLocal(historicoAtual).sort((a, b) => b.data.localeCompare(a.data));
  const valores = ultimos.map((h) => h.valor);
  $("#hist-menor").textContent = valores.length ? formatarMoeda(Math.min(...valores)) : "—";
  $("#hist-maior").textContent = valores.length ? formatarMoeda(Math.max(...valores)) : "—";
  $("#hist-media").textContent = valores.length ? formatarMoeda(valores.reduce((s, v) => s + v, 0) / valores.length) : "—";
  // A linha-semente do cadastro guarda a data "2000-01-01" de propósito (pra nunca ser confundida
  // com a compra mais recente nas comparações de tendência/mais barato) — mas pra exibir pro
  // usuário, mostra a data de criação do espaço (a "data que cadastrei isso no app") em vez do
  // valor interno, sem tocar no que está gravado.
  const dataCadastroExibida = dataISODoTimestamp(espacoAtual.criadoEm);
  // Ícone em SVG (stroke=currentColor) em vez do emoji 🗑️ — emoji renderiza sempre colorido,
  // ignorando CSS, e aqui precisamos diferenciar visualmente lixeira ativa (azul) de inativa
  // (cinza, na linha do cadastro, que nunca pode ser excluída).
  const ICONE_LIXEIRA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M4 7h16"/><path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7"/><path d="M6 7l1 12.5a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7"/><path d="M10 11v6M14 11v6"/></svg>`;
  const cabecalho = `<div class="linha-historico linha-historico-cabecalho">
        <span class="local">Local</span>
        <span class="data">Data</span>
        <span class="valor">Valor</span>
        <span class="btn-excluir-historico" style="visibility:hidden">${ICONE_LIXEIRA}</span>
      </div>`;
  $("#tabela-historico").innerHTML = ultimos.length
    ? cabecalho + ultimos.map((h) => `<div class="linha-historico">
        <span class="local"><span class="badge-mini">${esc(locaisAtuais.find((l) => l.id === h.localId)?.nome || "—")}</span></span>
        <span class="data">${formatarDataBR(h.origemCadastro ? dataCadastroExibida : h.data)}</span>
        <span class="valor">${formatarMoeda(h.valor)}</span>
        <button class="btn-excluir-historico${h.origemCadastro ? "" : " ativo"}" data-local-id="${h.localId}" aria-label="Excluir registro" ${h.origemCadastro ? "disabled" : ""}>${ICONE_LIXEIRA}</button>
      </div>`).join("")
    : `<div class="vazio">Nenhuma compra registrada ainda para este item.</div>`;

  $("#tabela-historico").querySelectorAll(".btn-excluir-historico").forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm("Excluir o histórico de preço deste item neste local?")) return;
      btn.disabled = true;
      const localId = btn.dataset.localId;
      const registros = historicoAtual.filter((h) => h.localId === localId);
      await Promise.all(registros.map((h) => deleteDoc(doc(bd, "espacos", espacoIdAtual, "itens", item.id, "historicoPrecos", h.id))));
      exibirSucesso("Histórico excluído!");
      renderHistoricoItem(item);
    };
  });
}

function abrirFormNovoItem() {
  telaAnterior = "cadastro-itens";
  // Só o atalho "+ Cadastrar" dentro de uma lista (ou do modal de troca) seta isso de novo, logo
  // depois desta chamada — limpa aqui pra um "Novo item" vindo de Cadastros > Itens nunca herdar
  // uma lista/troca de uma visita anterior a este formulário.
  listaOrigemNovoItem = null;
  itemListaTrocaPendenteAoCadastrar = null;
  $("#fi-id").value = "";
  $("#fi-nome").value = "";
  $("#fi-descricao").value = "";
  $("#fi-descricao-unidade").value = "";
  $("#fi-valor").value = "";
  $("#fi-valor").disabled = false;
  $("#fi-valor-aviso").classList.add("hidden");
  $("#fi-marca").value = "";
  $("#fi-grupo-nome").value = "";
  $("#fi-grupo-id").value = "";
  $("#fi-unidade").value = "";
  // Local vem pré-marcado como "Não informado" — diferente de Grupo/Unidade, que começam vazios —
  // porque na prática quase ninguém sabe de antemão onde vai comprar um item recém-cadastrado.
  const localPadrao = locaisAtuais.find((l) => l.nome === NOME_LOCAL_NAO_INFORMADO);
  $("#fi-local-nome").value = localPadrao?.nome || "";
  $("#fi-local-id").value = localPadrao?.id || "";
  $("#btn-excluir-item").classList.add("hidden");
  $("#fi-nome-sugestoes").classList.add("hidden");
  $("#fi-grupo-sugestoes").classList.add("hidden");
  $("#fi-unidade-sugestoes").classList.add("hidden");
  $("#fi-local-sugestoes").classList.add("hidden");
  mostrarMsg("#msg-form-item", "", "");
  mostrarTelaCheia("form-item", "Novo item");
}

// Grupo, Unidade e Local são listas pequenas e fechadas — ao focar o campo vazio, mostra todas as
// opções cadastradas (não precisa digitar nada pra escolher); Grupo/Unidade nunca vêm
// pré-selecionados (só contam como escolhidos ao clicar numa sugestão), Local é a exceção — ver
// abrirFormNovoItem/abrirFormEditarItem.
function renderSugestoesGrupo(query) {
  const container = $("#fi-grupo-sugestoes");
  const termo = query.trim().toLowerCase();
  const encontrados = termo.length < 1 ? gruposAtuais : gruposAtuais.filter((g) => g.nome.toLowerCase().includes(termo));
  if (encontrados.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.innerHTML = encontrados.map((g) => `<div class="autocomplete-item" data-id="${g.id}"><span>${esc(g.nome)}</span></div>`).join("");
  container.classList.remove("hidden");
  container.querySelectorAll(".autocomplete-item").forEach((el) => {
    el.onclick = () => {
      const grupo = gruposAtuais.find((g) => g.id === el.dataset.id);
      if (!grupo) return;
      $("#fi-grupo-nome").value = grupo.nome;
      $("#fi-grupo-id").value = grupo.id;
      container.classList.add("hidden");
      container.innerHTML = "";
    };
  });
}
function renderSugestoesUnidade(query) {
  const container = $("#fi-unidade-sugestoes");
  const termo = query.trim().toLowerCase();
  const encontradas = termo.length < 1 ? unidadesAtuais : unidadesAtuais.filter((u) => u.nome.toLowerCase().includes(termo));
  if (encontradas.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.innerHTML = encontradas.map((u) => `<div class="autocomplete-item" data-unidade="${esc(u.nome)}"><span>${esc(u.nome)}</span></div>`).join("");
  container.classList.remove("hidden");
  container.querySelectorAll(".autocomplete-item").forEach((el) => {
    el.onclick = () => {
      $("#fi-unidade").value = el.dataset.unidade;
      container.classList.add("hidden");
      container.innerHTML = "";
    };
  });
}
function renderSugestoesLocalItem(query) {
  const container = $("#fi-local-sugestoes");
  const termo = query.trim().toLowerCase();
  const encontrados = termo.length < 1 ? locaisAtuais : locaisAtuais.filter((l) => l.nome.toLowerCase().includes(termo));
  if (encontrados.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.innerHTML = encontrados.map((l) => `<div class="autocomplete-item" data-id="${l.id}"><span>${esc(l.nome)}</span></div>`).join("");
  container.classList.remove("hidden");
  container.querySelectorAll(".autocomplete-item").forEach((el) => {
    el.onclick = () => {
      const local = locaisAtuais.find((l) => l.id === el.dataset.id);
      if (!local) return;
      $("#fi-local-nome").value = local.nome;
      $("#fi-local-id").value = local.id;
      container.classList.add("hidden");
      container.innerHTML = "";
    };
  });
}

// Sugere itens já cadastrados que combinam com o que está sendo digitado, pra evitar duplicar
// o mesmo produto no catálogo. Clicar numa sugestão abre o item existente para editar.
function renderSugestoesItem(query) {
  const container = $("#fi-nome-sugestoes");
  const termo = normalizarTexto(query);
  const idAtual = $("#fi-id").value;
  const encontrados = termo.length < 2
    ? []
    : itensAtuais.filter((i) => i.id !== idAtual && itemCombinaComBusca(i, termo)).slice(0, 6);

  if (encontrados.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.innerHTML = encontrados
    .map((i) => `<div class="autocomplete-item" data-id="${i.id}"><span>${esc(i.nome)}</span><span class="grupo">${esc(i.grupoNome || "")}</span></div>`)
    .join("");
  container.classList.remove("hidden");
  container.querySelectorAll(".autocomplete-item").forEach((el) => {
    el.onclick = () => {
      container.classList.add("hidden");
      const item = itensAtuais.find((i) => i.id === el.dataset.id);
      if (item) abrirFormEditarItem(item);
    };
  });
}
async function abrirFormEditarItem(item) {
  telaAnterior = "cadastro-itens";
  listaOrigemNovoItem = null;
  $("#fi-id").value = item.id;
  $("#fi-nome").value = item.nome;
  $("#fi-descricao").value = item.descricao || "";
  $("#fi-descricao-unidade").value = item.descricaoUnidade || "";
  $("#fi-valor").value = item.valor ? formatarMoeda(item.valor) : "";
  $("#fi-marca").value = item.marca || "";
  $("#fi-unidade").value = item.unidade;
  $("#fi-grupo-nome").value = item.grupoNome || "";
  $("#fi-grupo-id").value = item.grupoId || "";
  $("#fi-local-nome").value = item.localNome || "";
  $("#fi-local-id").value = item.localId || "";
  $("#btn-excluir-item").classList.remove("hidden");
  $("#fi-nome-sugestoes").classList.add("hidden");
  $("#fi-grupo-sugestoes").classList.add("hidden");
  $("#fi-unidade-sugestoes").classList.add("hidden");
  $("#fi-local-sugestoes").classList.add("hidden");
  mostrarMsg("#msg-form-item", "", "");
  mostrarTelaCheia("form-item", "Editar item");
  // Trava o campo "Valor" assim que existir compra registrada — ele vira dinâmico a partir daí
  // (conforme a configuração e o histórico), só volta a ser editável se todo o histórico real
  // desse item for excluído.
  const travado = await itemTemCompraRegistrada(item.id);
  $("#fi-valor").disabled = travado;
  $("#fi-valor-aviso").classList.toggle("hidden", !travado);
}
async function salvarItem() {
  const id = $("#fi-id").value;
  const nome = $("#fi-nome").value.trim();
  const grupoId = $("#fi-grupo-id").value;
  const grupoNome = gruposAtuais.find((g) => g.id === grupoId)?.nome || null;
  const unidade = unidadesAtuais.find((u) => u.nome.toLowerCase() === $("#fi-unidade").value.trim().toLowerCase())?.nome;
  const localId = $("#fi-local-id").value;
  const localNome = locaisAtuais.find((l) => l.id === localId)?.nome || null;
  if (!nome || !grupoId || !grupoNome) {
    mostrarMsg("#msg-form-item", "Digite o nome do grupo e selecione uma das sugestões.", "erro");
    return;
  }
  if (!unidade) {
    mostrarMsg("#msg-form-item", "Digite a unidade e selecione uma das sugestões.", "erro");
    return;
  }
  if (!localId || !localNome) {
    mostrarMsg("#msg-form-item", "Digite o local e selecione uma das sugestões.", "erro");
    return;
  }
  const dados = {
    nome, descricao: $("#fi-descricao").value.trim() || null, descricaoUnidade: $("#fi-descricao-unidade").value.trim() || null,
    valor: paraNumero($("#fi-valor").value), marca: $("#fi-marca").value.trim() || null, grupoId, grupoNome, unidade,
    localId, localNome,
  };
  if (!id) {
    // Item repetido só bloqueia quando TUDO é idêntico (nome, marca, descrição, grupo, unidade,
    // local e valor) — diferente de grupo/local/unidade/forma, o mesmo nome de item é legítimo
    // quando é uma variação (marca ou descrição diferente, por exemplo). Nome parecido mas não
    // 100% idêntico continua só avisando, como antes.
    if (itensAtuais.some((it) => itemIdenticoAoCadastro(it, dados))) {
      mostrarMsg("#msg-form-item", "Já existe um item idêntico no catálogo (mesmo nome, marca, descrição, grupo, unidade, local e valor).", "erro");
      return;
    }
    const parecido = encontrarNomeParecido(nome, itensAtuais);
    if (parecido) {
      const confirma = confirmarApesarDeParecido([
        `Nome: ${parecido.nome}`,
        parecido.marca ? `Marca: ${parecido.marca}` : null,
        `Grupo: ${parecido.grupoNome || "—"}`,
        `Unidade: ${parecido.unidade || "—"}`,
        parecido.descricaoUnidade ? `Descrição da unidade: ${parecido.descricaoUnidade}` : null,
        parecido.valor ? `Valor: ${formatarMoeda(parecido.valor)}` : null,
      ]);
      if (!confirma) return;
    }
  }
  $("#btn-salvar-item").disabled = true;
  try {
    if (id) {
      // Sincroniza a linha-semente do cadastro ANTES de gravar o item: o onSnapshot da coleção
      // "itens" dispara assim que o updateDoc abaixo acontece, e se a semente ainda não tivesse
      // sido atualizada nesse momento, a tela de Itens (que segue a preferência "último comprado")
      // renderizaria com o valor antigo do histórico.
      if (!(await itemTemCompraRegistrada(id))) {
        const snapHist = await getDocs(collection(bd, "espacos", espacoIdAtual, "itens", id, "historicoPrecos"));
        const semente = snapHist.docs.find((d) => d.data().origemCadastro);
        if (semente) {
          await updateDoc(doc(bd, "espacos", espacoIdAtual, "itens", id, "historicoPrecos", semente.id), { valor: dados.valor, localId: dados.localId });
        } else {
          await addDoc(collection(bd, "espacos", espacoIdAtual, "itens", id, "historicoPrecos"), {
            localId: dados.localId, valor: dados.valor, data: "2000-01-01", listaId: null, origemCadastro: true,
          });
        }
      }
      await updateDoc(doc(bd, "espacos", espacoIdAtual, "itens", id), dados);
    } else {
      const refItem = await addDoc(collection(bd, "espacos", espacoIdAtual, "itens"), dados);
      await addDoc(collection(bd, "espacos", espacoIdAtual, "itens", refItem.id, "historicoPrecos"), {
        localId: dados.localId, valor: dados.valor, data: "2000-01-01", listaId: null, origemCadastro: true,
      });
      notificarMembrosEspaco(`${nomeExibicaoUsuario()} cadastrou o item "${nome}".`);
      // Cadastro veio do atalho "+ Cadastrar" de dentro de uma lista (busca sem resultado) —
      // pergunta se quer aproveitar e já jogar o item recém-criado nessa mesma lista, em vez de
      // ter que abrir "Adicionar item" e buscar de novo.
      if (listaOrigemNovoItem) {
        const listaId = listaOrigemNovoItem;
        listaOrigemNovoItem = null;
        const listaAlvo = listasAtuais.find((l) => l.id === listaId);
        if (listaAlvo && confirm(`Adicionar "${nome}" à lista "${listaAlvo.nome}"?`)) {
          const adicionadoPorNome = nomeExibicaoUsuario();
          await addDoc(collection(bd, "espacos", espacoIdAtual, "listas", listaId, "itensLista"), {
            itemId: refItem.id, nome: dados.nome, marca: dados.marca, descricao: dados.descricao,
            descricaoUnidade: dados.descricaoUnidade, unidade: dados.unidade, grupoNome: dados.grupoNome,
            quantidade: 1, valorProvisionado: dados.valor, subtotal: dados.valor, subtotalProvisionado: dados.valor,
            comprado: false, localCompraId: null, valorPago: null, compradoPor: null, compradoEm: null,
            adicionadoPor: usuario.uid, adicionadoPorNome,
          });
          recalcularTotaisLista(listaId);
          notificarMembrosEspaco(`${adicionadoPorNome} adicionou "${dados.nome}" à lista "${listaAlvo.nome}".`);
        }
      }
      // Cadastro veio do atalho "+ Cadastrar" de dentro do modal de troca — pergunta se quer
      // trocar a linha original pelo item recém-criado (mesma ideia do fluxo de adicionar acima,
      // mas substituindo a linha em vez de criar uma nova).
      if (itemListaTrocaPendenteAoCadastrar) {
        const itemListaId = itemListaTrocaPendenteAoCadastrar;
        itemListaTrocaPendenteAoCadastrar = null;
        const itemLista = itensListaAtuais.find((i) => i.id === itemListaId);
        if (itemLista && confirm(`Trocar "${itemLista.nome}" por "${nome}"?`)) {
          let quantidade = itemLista.quantidade || 1;
          if (!unidadeAceitaFracao(dados.unidade)) quantidade = Math.round(quantidade) || 1;
          await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista", itemListaId), {
            itemId: refItem.id, nome: dados.nome, marca: dados.marca, descricao: dados.descricao,
            descricaoUnidade: dados.descricaoUnidade, unidade: dados.unidade, grupoNome: dados.grupoNome,
            quantidade, valorProvisionado: dados.valor, subtotal: quantidade * dados.valor, subtotalProvisionado: quantidade * dados.valor,
          });
          recalcularTotaisLista();
        }
      }
    }
    exibirSucesso("Item salvo com sucesso!");
    voltarParaTelaAnterior();
  } catch {
    mostrarMsg("#msg-form-item", "Não foi possível salvar. Tente novamente.", "erro");
  }
  $("#btn-salvar-item").disabled = false;
}
async function excluirItemAtual() {
  const id = $("#fi-id").value;
  if (!id || !confirm("Excluir este item do catálogo?")) return;
  await deleteDoc(doc(bd, "espacos", espacoIdAtual, "itens", id));
  irParaTela("cadastro-itens");
}

/* ---------- cadastro: grupos ---------- */
function renderCadastroGrupos() {
  const termo = normalizarTexto(termoBuscaCadastro.grupos);
  const lista = termo ? gruposAtuais.filter((g) => normalizarTexto(g.nome).includes(termo)) : gruposAtuais;
  $("#total-grupos").textContent = `${lista.length} Grupo${lista.length === 1 ? "" : "s"}`;
  const container = $("#lista-cadastro-grupos");
  if (lista.length === 0) {
    container.innerHTML = `<div class="vazio">${termo ? "Nenhum grupo encontrado." : "Nenhum grupo cadastrado."}</div>`;
    return;
  }
  container.innerHTML = lista
    .map((g) => `<div class="item" data-id="${g.id}"><div class="info"><div class="nome">${esc(g.nome)}</div>${g.descricao ? `<div class="detalhe"><span>${esc(g.descricao)}</span></div>` : ""}</div></div>`)
    .join("");
  container.querySelectorAll(".item").forEach((el) => {
    el.onclick = () => abrirFormEditarGrupo(gruposAtuais.find((g) => g.id === el.dataset.id));
  });
}
function abrirFormNovoGrupo() {
  telaAnterior = "cadastro-grupos";
  $("#fg-id").value = "";
  $("#fg-nome").value = "";
  $("#fg-descricao").value = "";
  $("#btn-excluir-grupo").classList.add("hidden");
  mostrarMsg("#msg-form-grupo", "", "");
  mostrarTelaCheia("form-grupo", "Novo grupo");
}
function abrirFormEditarGrupo(grupo) {
  telaAnterior = "cadastro-grupos";
  $("#fg-id").value = grupo.id;
  $("#fg-nome").value = grupo.nome;
  $("#fg-descricao").value = grupo.descricao || "";
  $("#btn-excluir-grupo").classList.remove("hidden");
  mostrarMsg("#msg-form-grupo", "", "");
  mostrarTelaCheia("form-grupo", "Editar grupo");
}
async function salvarGrupo() {
  const id = $("#fg-id").value;
  const nome = $("#fg-nome").value.trim();
  if (!nome) {
    mostrarMsg("#msg-form-grupo", "Informe o nome do grupo.", "erro");
    return;
  }
  if (!id && !podeSalvarComEsseNome("#msg-form-grupo", nome, gruposAtuais, (p) => [
    `Nome: ${p.nome}`,
    p.descricao ? `Descrição: ${p.descricao}` : null,
  ])) return;
  const dados = { nome, descricao: $("#fg-descricao").value.trim() || null };
  if (id) {
    await updateDoc(doc(bd, "espacos", espacoIdAtual, "grupos", id), dados);
  } else {
    await addDoc(collection(bd, "espacos", espacoIdAtual, "grupos"), dados);
    notificarMembrosEspaco(`${nomeExibicaoUsuario()} criou o grupo "${nome}".`);
  }
  exibirSucesso("Grupo salvo com sucesso!");
  irParaTela("cadastro-grupos");
}
async function excluirGrupoAtual() {
  const id = $("#fg-id").value;
  if (!id) return;
  if (itensAtuais.some((i) => i.grupoId === id)) {
    mostrarMsg("#msg-form-grupo", "Este grupo está vinculado a um ou mais itens do catálogo — mude o grupo desses itens antes de excluir.", "erro");
    return;
  }
  if (!confirm("Excluir este grupo?")) return;
  await deleteDoc(doc(bd, "espacos", espacoIdAtual, "grupos", id));
  irParaTela("cadastro-grupos");
}

/* ---------- cadastro: locais ---------- */
function renderCadastroLocais() {
  const termo = normalizarTexto(termoBuscaCadastro.locais);
  const lista = termo ? locaisAtuais.filter((l) => normalizarTexto(l.nome).includes(termo)) : locaisAtuais;
  $("#total-locais").textContent = `${lista.length} ${lista.length === 1 ? "Local" : "Locais"}`;
  const container = $("#lista-cadastro-locais");
  if (lista.length === 0) {
    container.innerHTML = `<div class="vazio">${termo ? "Nenhum local encontrado." : "Nenhum local cadastrado."}</div>`;
    return;
  }
  container.innerHTML = lista
    .map((l) => `<div class="item" data-id="${l.id}"><div class="info"><div class="nome">${l.site ? `<button type="button" class="btn-site-atalho" data-site="${esc(l.site)}" aria-label="Abrir site">${ICONE_SITE}</button>` : ""}${esc(l.nome)}</div>${l.cidade || l.endereco ? `<div class="detalhe"><span>${esc(l.endereco || "")}</span><span>${esc(l.cidade || "")}</span></div>` : ""}</div></div>`)
    .join("");
  container.querySelectorAll(".item").forEach((el) => {
    el.onclick = () => abrirFormEditarLocal(locaisAtuais.find((l) => l.id === el.dataset.id));
  });
  container.querySelectorAll(".btn-site-atalho").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      window.open(btn.dataset.site, "_blank", "noopener");
    };
  });
}

// Compara o preço pago em cada local com a média do próprio item (não com o preço de outros
// itens, que não são comparáveis entre si) — assim um local que só aparece em compras de itens
// mais caros não é injustamente marcado como "mais caro" no ranking geral.
// Se o mesmo item foi comprado mais de uma vez no mesmo local (com valores diferentes), só o
// registro mais recente representa o preço "atual" desse local — os demais ficam só como
// histórico bruto, sem entrar nas médias/comparações usadas nos dashboards e listagens.
function ultimosPorLocal(registros) {
  const porLocal = new Map();
  for (const r of registros) {
    const atual = porLocal.get(r.localId);
    if (!atual || r.data > atual.data) porLocal.set(r.localId, r);
  }
  return [...porLocal.values()];
}

function abrirFormNovoLocal() {
  telaAnterior = "cadastro-locais";
  $("#fl-id").value = "";
  $("#fl-nome").value = "";
  $("#fl-endereco").value = "";
  $("#fl-cidade").value = "";
  $("#fl-site").value = "";
  $("#btn-abrir-site-local").classList.add("hidden");
  $("#btn-excluir-local").classList.add("hidden");
  $("#fl-itens-baratos-card").classList.add("hidden");
  mostrarMsg("#msg-form-local", "", "");
  mostrarTelaCheia("form-local", "Novo local");
}
function abrirFormEditarLocal(local) {
  telaAnterior = "cadastro-locais";
  $("#fl-id").value = local.id;
  $("#fl-nome").value = local.nome;
  $("#fl-endereco").value = local.endereco || "";
  $("#fl-cidade").value = local.cidade || "";
  $("#fl-site").value = local.site || "";
  $("#btn-abrir-site-local").classList.toggle("hidden", !local.site);
  $("#btn-excluir-local").classList.remove("hidden");
  mostrarMsg("#msg-form-local", "", "");
  mostrarTelaCheia("form-local", "Editar local");
  renderItensMaisBaratosNoLocal(local.id);
}

// Compara, item a item, a média de preço pago neste local com a média nos demais locais onde o
// mesmo item já foi comprado — só entram itens comprados em 2+ locais diferentes, senão não há
// o que comparar.
async function renderItensMaisBaratosNoLocal(localId) {
  const card = $("#fl-itens-baratos-card");
  const container = $("#fl-itens-baratos");
  card.classList.remove("hidden");
  container.innerHTML = `<div class="dash-vazio">Calculando...</div>`;

  const maisBaratosAqui = [];
  for (const item of itensAtuais) {
    const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "itens", item.id, "historicoPrecos"));
    const ultimos = ultimosPorLocal(snap.docs.map((d) => d.data()));
    if (ultimos.length < 2 || !ultimos.some((r) => r.localId === localId)) continue;

    const melhor = ultimos.reduce((min, r) => (r.valor < min.valor ? r : min));
    if (melhor.localId === localId) maisBaratosAqui.push({ nome: item.nome, valor: melhor.valor });
  }

  maisBaratosAqui.sort((a, b) => a.valor - b.valor);
  const top10 = maisBaratosAqui.slice(0, 10);
  container.innerHTML = top10.length
    ? top10.map((i) => `<div class="item-aplicacao"><span class="nome">${esc(i.nome)}</span><span class="valor">${formatarMoeda(i.valor)}</span></div>`).join("")
    : `<div class="dash-vazio">Ainda sem itens em que este local seja o mais barato — precisa comprar o mesmo item em outro local para comparar.</div>`;
}
async function salvarLocal() {
  const id = $("#fl-id").value;
  const nome = $("#fl-nome").value.trim();
  if (!nome) {
    mostrarMsg("#msg-form-local", "Informe o nome do local.", "erro");
    return;
  }
  if (!id && !podeSalvarComEsseNome("#msg-form-local", nome, locaisAtuais, (p) => [
    `Nome: ${p.nome}`,
    p.endereco ? `Endereço: ${p.endereco}` : null,
    p.cidade ? `Cidade: ${p.cidade}` : null,
  ])) return;
  let site = $("#fl-site").value.trim() || null;
  if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`;
  const dados = { nome, endereco: $("#fl-endereco").value.trim() || null, cidade: $("#fl-cidade").value.trim() || null, site };
  if (id) {
    await updateDoc(doc(bd, "espacos", espacoIdAtual, "locais", id), dados);
  } else {
    await addDoc(collection(bd, "espacos", espacoIdAtual, "locais"), dados);
    notificarMembrosEspaco(`${nomeExibicaoUsuario()} criou o local "${nome}".`);
  }
  exibirSucesso("Local salvo com sucesso!");
  irParaTela("cadastro-locais");
}
async function excluirLocalAtual() {
  const id = $("#fl-id").value;
  if (!id) return;
  $("#btn-excluir-local").disabled = true;
  try {
    for (const item of itensAtuais) {
      const snap = await getDocs(query(collection(bd, "espacos", espacoIdAtual, "itens", item.id, "historicoPrecos"), where("localId", "==", id)));
      if (!snap.empty) {
        mostrarMsg("#msg-form-local", "Este local já tem compras registradas (histórico de preços) — não é possível excluir.", "erro");
        return;
      }
    }
    if (!confirm("Excluir este local?")) return;
    await deleteDoc(doc(bd, "espacos", espacoIdAtual, "locais", id));
    irParaTela("cadastro-locais");
  } finally {
    $("#btn-excluir-local").disabled = false;
  }
}

/* ---------- cadastro: formas de pagamento ---------- */
function renderCadastroFormas() {
  const termo = normalizarTexto(termoBuscaCadastro.formas);
  const lista = termo ? formasAtuais.filter((f) => normalizarTexto(f.nome).includes(termo)) : formasAtuais;
  $("#total-formas").textContent = `${lista.length} Forma${lista.length === 1 ? "" : "s"} de pagamento`;
  const container = $("#lista-cadastro-formas");
  if (lista.length === 0) {
    container.innerHTML = `<div class="vazio">${termo ? "Nenhuma forma de pagamento encontrada." : "Nenhuma forma de pagamento cadastrada."}</div>`;
    return;
  }
  container.innerHTML = lista.map((f) => `<div class="item" data-id="${f.id}"><div class="info"><div class="nome">${esc(f.nome)}</div></div></div>`).join("");
  container.querySelectorAll(".item").forEach((el) => {
    el.onclick = () => abrirFormEditarForma(formasAtuais.find((f) => f.id === el.dataset.id));
  });
}
function abrirFormNovaForma() {
  telaAnterior = "cadastro-formas";
  $("#ff-id").value = "";
  $("#ff-nome").value = "";
  $("#btn-excluir-forma").classList.add("hidden");
  mostrarMsg("#msg-form-forma", "", "");
  mostrarTelaCheia("form-forma", "Nova forma de pagamento");
}
function abrirFormEditarForma(forma) {
  telaAnterior = "cadastro-formas";
  $("#ff-id").value = forma.id;
  $("#ff-nome").value = forma.nome;
  $("#btn-excluir-forma").classList.remove("hidden");
  mostrarMsg("#msg-form-forma", "", "");
  mostrarTelaCheia("form-forma", "Editar forma de pagamento");
}
async function salvarForma() {
  const id = $("#ff-id").value;
  const nome = $("#ff-nome").value.trim();
  if (!nome) {
    mostrarMsg("#msg-form-forma", "Informe o nome da forma de pagamento.", "erro");
    return;
  }
  if (!id && !podeSalvarComEsseNome("#msg-form-forma", nome, formasAtuais, (p) => [`Nome: ${p.nome}`])) return;
  if (id) {
    await updateDoc(doc(bd, "espacos", espacoIdAtual, "formasPagamento", id), { nome });
  } else {
    await addDoc(collection(bd, "espacos", espacoIdAtual, "formasPagamento"), { nome });
    notificarMembrosEspaco(`${nomeExibicaoUsuario()} criou a forma de pagamento "${nome}".`);
  }
  exibirSucesso("Forma de pagamento salva!");
  irParaTela("cadastro-formas");
}
async function excluirFormaAtual() {
  const id = $("#ff-id").value;
  if (!id) return;
  // "formaPagamentoId" (singular) é o esquema antigo, de antes de uma compra poder ser dividida
  // em mais de uma forma de pagamento — mantido aqui só pra não perder a checagem em compras
  // finalizadas antes dessa mudança.
  const emUso = listasAtuais.some((l) => l.formaPagamentoId === id || (l.pagamentos || []).some((p) => p.formaPagamentoId === id));
  if (emUso) {
    mostrarMsg("#msg-form-forma", "Esta forma de pagamento está vinculada a uma compra já finalizada — não é possível excluir.", "erro");
    return;
  }
  if (!confirm("Excluir esta forma de pagamento?")) return;
  await deleteDoc(doc(bd, "espacos", espacoIdAtual, "formasPagamento", id));
  irParaTela("cadastro-formas");
}

/* ---------- cadastro: unidades de medida ---------- */
function renderCadastroUnidades() {
  const termo = normalizarTexto(termoBuscaCadastro.unidades);
  const lista = termo ? unidadesAtuais.filter((u) => normalizarTexto(u.nome).includes(termo)) : unidadesAtuais;
  $("#total-unidades").textContent = `${lista.length} Unidade${lista.length === 1 ? "" : "s"} de medida`;
  const container = $("#lista-cadastro-unidades");
  if (lista.length === 0) {
    container.innerHTML = `<div class="vazio">${termo ? "Nenhuma unidade encontrada." : "Nenhuma unidade de medida cadastrada."}</div>`;
    return;
  }
  container.innerHTML = lista.map((u) => `<div class="item" data-id="${u.id}"><div class="info"><div class="nome">${esc(u.nome)}</div></div></div>`).join("");
  container.querySelectorAll(".item").forEach((el) => {
    el.onclick = () => abrirFormEditarUnidade(unidadesAtuais.find((u) => u.id === el.dataset.id));
  });
}
function abrirFormNovaUnidade() {
  telaAnterior = "cadastro-unidades";
  $("#fu-id").value = "";
  $("#fu-nome").value = "";
  $("#fu-abreviacao").value = "";
  fracionavelUnidadeSelecionado = null;
  renderOpcoesFracionavelUnidade();
  $("#btn-excluir-unidade").classList.add("hidden");
  mostrarMsg("#msg-form-unidade", "", "");
  mostrarTelaCheia("form-unidade", "Nova unidade de medida");
}
function abrirFormEditarUnidade(unidade) {
  telaAnterior = "cadastro-unidades";
  $("#fu-id").value = unidade.id;
  $("#fu-nome").value = unidade.nome;
  // Sem abreviação salva ainda, sugere a padrão conhecida (kg, g, ml, un.) se houver uma pra
  // esse nome — só como ponto de partida, continua editável e é gravada explícita ao salvar.
  $("#fu-abreviacao").value = unidade.abreviacao ?? ABREVIACOES_UNIDADE[unidade.nome.trim().toLowerCase()] ?? "";
  // Unidade antiga sem o campo cadastrado: pré-preenche com o heurístico por nome, mas
  // ainda assim grava um valor explícito da próxima vez que for salva.
  fracionavelUnidadeSelecionado = unidadeAceitaFracao(unidade.nome) ? "sim" : "nao";
  renderOpcoesFracionavelUnidade();
  $("#btn-excluir-unidade").classList.remove("hidden");
  mostrarMsg("#msg-form-unidade", "", "");
  mostrarTelaCheia("form-unidade", "Editar unidade de medida");
}
async function salvarUnidade() {
  const id = $("#fu-id").value;
  const nome = $("#fu-nome").value.trim();
  if (!nome) {
    mostrarMsg("#msg-form-unidade", "Informe o nome da unidade de medida.", "erro");
    return;
  }
  if (!fracionavelUnidadeSelecionado) {
    mostrarMsg("#msg-form-unidade", "Selecione se a unidade aceita quantidade fracionada.", "erro");
    return;
  }
  if (!id && !podeSalvarComEsseNome("#msg-form-unidade", nome, unidadesAtuais, (p) => [
    `Nome: ${p.nome}`,
    `Aceita fração: ${p.fracionavel ? "Sim" : "Não"}`,
  ])) return;
  const dados = { nome, fracionavel: fracionavelUnidadeSelecionado === "sim", abreviacao: $("#fu-abreviacao").value.trim() || null };
  if (id) {
    await updateDoc(doc(bd, "espacos", espacoIdAtual, "unidadesMedida", id), dados);
  } else {
    await addDoc(collection(bd, "espacos", espacoIdAtual, "unidadesMedida"), dados);
    notificarMembrosEspaco(`${nomeExibicaoUsuario()} criou a unidade de medida "${nome}".`);
  }
  exibirSucesso("Unidade de medida salva!");
  irParaTela("cadastro-unidades");
}
async function excluirUnidadeAtual() {
  const id = $("#fu-id").value;
  if (!id) return;
  const unidade = unidadesAtuais.find((u) => u.id === id);
  if (unidade && itensAtuais.some((i) => i.unidade === unidade.nome)) {
    mostrarMsg("#msg-form-unidade", "Esta unidade está vinculada a um ou mais itens do catálogo — mude a unidade desses itens antes de excluir.", "erro");
    return;
  }
  if (!confirm("Excluir esta unidade de medida?")) return;
  await deleteDoc(doc(bd, "espacos", espacoIdAtual, "unidadesMedida", id));
  irParaTela("cadastro-unidades");
}

/* ---------- listas compartilhadas (convites por e-mail) ---------- */
function renderMembros() {
  const membros = espacoAtual.membrosInfo || {};
  const container = $("#lista-membros");
  const entradas = Object.values(membros);
  container.innerHTML = entradas.length
    ? entradas.map((m) => `<div class="linha-membro">
        <div class="avatar-membro">${esc((m.nome || m.email || "?").trim()[0].toUpperCase())}</div>
        <div class="info">
          <span class="nome">${esc(m.nome || m.email)}</span>
          ${m.nome ? `<span class="email">${esc(m.email)}</span>` : ""}
        </div>
      </div>`).join("")
    : `<div class="vazio">Nenhum membro encontrado.</div>`;
}
function renderConvitesPendentes() {
  const pendentes = convitesAtuais.filter((c) => c.status === "pendente");
  const container = $("#lista-convites");
  container.innerHTML = pendentes.length
    ? pendentes.map((c) => `<div class="linha-convite-pendente" data-id="${c.id}">
        <div class="avatar-membro">${esc((c.deEmail || "?").trim()[0].toUpperCase())}</div>
        <div class="info">
          <span class="nome">${esc(c.deEmail)}</span>
          <span class="email">Convite enviado</span>
        </div>
        <div class="acoes">
          <button data-acao="aceitar" class="aceitar">Aceitar</button>
          <button data-acao="recusar">Recusar</button>
        </div>
      </div>`).join("")
    : `<div class="vazio">Nenhum convite pendente.</div>`;
  container.querySelectorAll('[data-acao="aceitar"]').forEach((btn) => {
    btn.onclick = () => aceitarConvite(convitesAtuais.find((c) => c.id === btn.closest(".linha-convite-pendente").dataset.id));
  });
  container.querySelectorAll('[data-acao="recusar"]').forEach((btn) => {
    btn.onclick = () => recusarConvite(convitesAtuais.find((c) => c.id === btn.closest(".linha-convite-pendente").dataset.id));
  });
}
function assinarConvitesRecebidos() {
  if (unsubConvites) unsubConvites();
  const email = normalizarEmail(usuario.email || "");
  unsubConvites = onSnapshot(query(collection(bd, "convites"), where("paraEmail", "==", email)), (snap) => {
    convitesAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderConvitesPendentes();
  });
}

/* ---------- notificações (sino) ---------- */
function formatarQuandoNotificacao(criadoEm) {
  const data = criadoEm?.toDate ? criadoEm.toDate() : new Date();
  const diffMs = Date.now() - data.getTime();
  const minutos = Math.floor(diffMs / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias}d`;
}
function assinarNotificacoes() {
  if (unsubNotificacoes) unsubNotificacoes();
  unsubNotificacoes = onSnapshot(query(collection(bd, "notificacoes"), where("uidDestino", "==", usuario.uid)), (snap) => {
    notificacoesAtuais = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.criadoEm?.toMillis?.() || 0) - (a.criadoEm?.toMillis?.() || 0));
    renderNotificacoes();
  });
}
function renderNotificacoes() {
  const badge = $("#badge-sino");
  const naoLidas = notificacoesAtuais.filter((n) => !n.lida).length;
  badge.textContent = naoLidas > 9 ? "9+" : String(naoLidas);
  badge.classList.toggle("hidden", naoLidas === 0);

  const container = $("#lista-notificacoes");
  if (notificacoesAtuais.length === 0) {
    container.innerHTML = `<div class="notif-vazio">Nenhuma notificação.</div>`;
    return;
  }
  container.innerHTML = notificacoesAtuais
    .map((n) => `<div class="notif-item ${n.lida ? "" : "nao-lida"}" data-id="${n.id}">
      <div class="notif-corpo">
        <div class="notif-msg">${esc(n.mensagem)}</div>
        <div class="notif-quando">${formatarQuandoNotificacao(n.criadoEm)}</div>
      </div>
      <button type="button" class="btn-excluir-notif" data-acao="excluir" aria-label="Excluir notificação">✕</button>
    </div>`)
    .join("");
  container.querySelectorAll(".notif-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".btn-excluir-notif")) return;
      const notif = notificacoesAtuais.find((n) => n.id === el.dataset.id);
      if (notif?.tipo === "atualizacao_disponivel") {
        irParaTela(telaAnterior);
        abrirMenu();
      } else if (notif?.tipo === "convite_recebido" || notif?.tipo === "convite_aceito") {
        irParaTela("compartilhadas");
      }
      // Demais tipos (item/grupo/lista cadastrados etc.): só exibe a mensagem — abrir a tela de
      // notificações já marca tudo como lida, então clicar aqui não precisa levar a lugar nenhum.
    });
  });
  container.querySelectorAll(".btn-excluir-notif").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      deleteDoc(doc(bd, "notificacoes", btn.closest(".notif-item").dataset.id));
    };
  });
}
function abrirNotificacoes() {
  telaAnterior = TELAS_PRINCIPAIS.find((t) => !$(`#tela-${t}`).classList.contains("hidden")) || "inicio";
  mostrarTelaCheia("notificacoes", "Notificações");
  marcarNotificacoesComoLidas();
}
// Some com o sinal vermelho do sino assim que a pessoa abre a tela — as notificações continuam
// na lista (só desaparecem se excluídas), mas deixam de contar no badge.
async function marcarNotificacoesComoLidas() {
  const naoLidas = notificacoesAtuais.filter((n) => !n.lida);
  if (naoLidas.length === 0) return;
  const batch = writeBatch(bd);
  naoLidas.forEach((n) => batch.update(doc(bd, "notificacoes", n.id), { lida: true }));
  try {
    await batch.commit();
  } catch {
    // Regra do Firestore ainda não liberou update em notificacoes (ex.: regra desatualizada no
    // console) — falha aqui não deve travar a tela, só o badge não vai zerar até resolver.
  }
}
async function limparTodasNotificacoes() {
  const batch = writeBatch(bd);
  notificacoesAtuais.forEach((n) => batch.delete(doc(bd, "notificacoes", n.id)));
  await batch.commit();
}
function idConvite(espacoId, email) {
  return `${espacoId}_${email}`;
}
async function convidarParaEspaco() {
  const paraEmail = normalizarEmail($("#comp-email").value);
  const deEmail = normalizarEmail(usuario.email || "");
  if (!paraEmail) {
    mostrarMsg("#msg-compartilhadas", "Digite um e-mail válido.", "erro");
    return;
  }
  if (paraEmail === deEmail) {
    mostrarMsg("#msg-compartilhadas", "Você já faz parte deste espaço.", "erro");
    return;
  }
  const indice = await getDoc(doc(bd, "indiceEmails", paraEmail));
  const paraUid = indice.exists() ? indice.data().uid : null;
  try {
    await setDoc(doc(bd, "convites", idConvite(espacoIdAtual, paraEmail)), {
      espacoId: espacoIdAtual, deUid: usuario.uid, deEmail, paraEmail, paraUid, status: "pendente", criadoEm: serverTimestamp(),
    });
    if (paraUid) {
      const deNome = `${perfilAtual.nome} ${perfilAtual.sobrenome}`.trim() || deEmail;
      await addDoc(collection(bd, "notificacoes"), {
        tipo: "convite_recebido", uidDestino: paraUid, espacoId: espacoIdAtual, paraEmail,
        mensagem: `${deNome} convidou você para compartilhar um espaço de listas de compras.`,
        criadoEm: serverTimestamp(), lida: false,
      });
    }
    // Sem conta encontrada pra esse e-mail: o convite ainda é criado (a pessoa pode aceitar
    // assim que se cadastrar), mas avisa aqui — é o único jeito de pegar um e-mail digitado
    // errado na hora, em vez de só falhar silenciosamente quando alguém tentar aceitar.
    mostrarMsg(
      "#msg-compartilhadas",
      paraUid
        ? `Convite enviado para ${paraEmail}.`
        : `Convite enviado para ${paraEmail}, mas ainda não encontramos uma conta com esse e-mail no Listô — confira se digitou certinho. Se a pessoa ainda não tem conta, ela poderá aceitar assim que se cadastrar.`,
      "ok"
    );
    $("#comp-email").value = "";
    exibirSucesso("Convite enviado!");
  } catch {
    mostrarMsg("#msg-compartilhadas", "Não foi possível enviar o convite.", "erro");
  }
}
async function aceitarConvite(convite) {
  if (!convite) return;
  const nomeAceitante = `${perfilAtual.nome} ${perfilAtual.sobrenome}`.trim() || normalizarEmail(usuario.email || "");
  const batch = writeBatch(bd);
  batch.update(doc(bd, "convites", convite.id), { status: "aceito", paraUid: usuario.uid });
  batch.update(doc(bd, "espacos", convite.espacoId), {
    membros: arrayUnion(usuario.uid),
    [`membrosInfo.${usuario.uid}`]: { nome: perfilAtual.nome, email: normalizarEmail(usuario.email || "") },
  });
  batch.update(doc(bd, "usuarios", usuario.uid), { espacoId: convite.espacoId });
  batch.set(doc(collection(bd, "notificacoes")), {
    tipo: "convite_aceito", uidDestino: convite.deUid, espacoId: convite.espacoId,
    mensagem: `${nomeAceitante} aceitou seu convite — agora vocês compartilham as mesmas listas, itens, grupos e locais.`,
    criadoEm: serverTimestamp(), lida: false,
  });
  try {
    await batch.commit();
    exibirSucesso("Convite aceito! Agora vocês compartilham o mesmo espaço.");
  } catch {
    // A gravação é tudo-ou-nada (mesmo batch): se as regras do Firestore recusarem a troca de
    // espaço (ex.: e-mail do convite não bate certinho com o e-mail desta conta), nada é
    // aplicado — nem o status do convite muda. Sem isso, falhava calado e a pessoa achava que
    // tinha aceitado, mas continuava no próprio espaço.
    exibirSucesso("Não foi possível aceitar o convite. Confira se o e-mail usado no convite é exatamente o mesmo desta conta.", 4000);
  }
}
async function recusarConvite(convite) {
  if (!convite) return;
  await updateDoc(doc(bd, "convites", convite.id), { status: "recusado" });
}

/* ---------- navegação ---------- */
const TELAS_PRINCIPAIS = ["inicio", "listas", "cadastro-itens", "cadastro-grupos", "cadastro-locais", "cadastro-formas", "cadastro-unidades", "compartilhadas", "configuracoes", "seguranca"];
const TELAS_CHEIAS = ["lista-detalhe", "item-detalhe", "form-item", "form-grupo", "form-local", "form-forma", "form-unidade", "form-lista", "perfil", "notificacoes"];
const TODAS_AS_TELAS = [...TELAS_PRINCIPAIS, ...TELAS_CHEIAS];

const TITULOS_TELA_PRINCIPAL = {
  inicio: "Início", listas: "Listas de Compras", "cadastro-itens": "Itens", "cadastro-grupos": "Grupos",
  "cadastro-locais": "Locais", "cadastro-formas": "Formas de Pagamento", "cadastro-unidades": "Unidades de Medida",
  compartilhadas: "Participantes", configuracoes: "Configurações", seguranca: "Segurança",
};

// iOS Safari (principalmente PWA instalado na tela de início) tem um bug conhecido: um <main>
// com overflow-y:auto que estava dentro de display:none quando a tela trocou não fica
// arrastável por toque até sofrer um reflow forçado — no mouse/desktop rola normalmente, o que
// mascara o problema em teste local. Forçar esse reflow logo depois de exibir a tela evita telas
// "travadas" que não rolam no celular.
function reativarScrollTela(nome) {
  requestAnimationFrame(() => {
    const main = document.querySelector(`#tela-${nome} main`);
    if (!main) return;
    main.style.overflow = "hidden";
    void main.offsetHeight;
    main.style.overflow = "";
  });
}
function irParaTela(nome) {
  TODAS_AS_TELAS.forEach((t) => $(`#tela-${t}`).classList.toggle("hidden", t !== nome));
  document.querySelectorAll(".menu-item").forEach((item) => item.classList.toggle("ativa", item.dataset.tela === nome));
  $("#topbar-titulo").textContent = TITULOS_TELA_PRINCIPAL[nome] ?? "";
  $("#btn-menu").classList.remove("modo-voltar");
  // O histórico de preços muda com frequência (toda compra confirmada) sem que o cadastro de
  // itens mude — precisa recalcular também ao simplesmente abrir a tela (senão mostra o valor de
  // quando a tela foi renderizada pela última vez, não o atual).
  if (nome === "cadastro-itens") renderCadastroItens();
  // O filtro de mês da tela "Listas de Compras" nunca persiste de uma visita pra outra — sempre
  // volta a abrir no mês atual.
  if (nome === "listas") {
    aplicarFiltroMesAtualListas();
    renderCarrosselListas();
  }
  reativarScrollTela(nome);
}
function mostrarTelaCheia(nome, titulo) {
  TODAS_AS_TELAS.forEach((t) => $(`#tela-${t}`).classList.toggle("hidden", t !== nome));
  $("#topbar-titulo").textContent = titulo;
  $("#btn-menu").classList.add("modo-voltar");
  reativarScrollTela(nome);
}
function abrirMenu() {
  $("#menu-lateral").classList.add("aberto");
  $("#overlay-menu").classList.remove("hidden");
  $("#menu-submenu-cadastros").classList.add("hidden");
  $("#menu-cadastros-chevron").classList.remove("aberto");
}
function fecharMenu() {
  $("#menu-lateral").classList.remove("aberto");
  $("#overlay-menu").classList.add("hidden");
}
function alternarSubmenuCadastros() {
  const submenu = $("#menu-submenu-cadastros");
  const abrir = submenu.classList.contains("hidden");
  submenu.classList.toggle("hidden", !abrir);
  $("#menu-cadastros-chevron").classList.toggle("aberto", abrir);
}
function alternarFabInicio() {
  const aberto = $("#fab-inicio-dial").classList.toggle("aberto");
  $("#fab-inicio").classList.toggle("aberto", aberto);
  $("#fab-inicio-overlay").classList.toggle("hidden", !aberto);
}
function fecharFabInicio() {
  $("#fab-inicio-dial").classList.remove("aberto");
  $("#fab-inicio").classList.remove("aberto");
  $("#fab-inicio-overlay").classList.add("hidden");
}
function aplicarTema(escuro) {
  if (escuro) document.documentElement.setAttribute("data-tema", "escuro");
  else document.documentElement.removeAttribute("data-tema");
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", escuro ? "#0b1420" : "#f4f7f9");
}
function abrirPerfil() {
  telaAnterior = TELAS_PRINCIPAIS.find((t) => !$(`#tela-${t}`).classList.contains("hidden")) || "inicio";
  preencherFormPerfil();
  mostrarTelaCheia("perfil", "Meu perfil");
}

/* ---------- onboarding do primeiro acesso ---------- */
const ONBOARDING_PASSOS = [
  {
    icone: "🛒",
    titulo: "Bem-vindo(a) ao Listô!",
    corpo: "Seu <b>espaço de compras</b>: tudo que você cadastrar pode ser compartilhado com quem você convidar.",
  },
  {
    icone: "📦",
    titulo: "Comece pelos cadastros",
    corpo: "No menu, cadastre <b>Itens, Grupos, Locais</b> e <b>Formas de Pagamento</b>. Alguns exemplos já vêm prontos.",
  },
  {
    icone: "📋",
    titulo: "Monte sua lista",
    corpo: "O item do catálogo não tem preço fixo — quantidade e valor são informados <b>na lista</b>. Ao marcar como comprado, informe o local e o valor pago: isso vira histórico de preços.",
  },
  {
    icone: "👥",
    titulo: "Compartilhe com alguém",
    corpo: "Convide pelo e-mail em <b>Listas Compartilhadas</b>. Ao aceitar, vocês passam a ver tudo juntos, em tempo real.",
  },
  {
    icone: "📲",
    titulo: "Adicione à tela de início (iPhone)",
    corpo: `No Safari: toque em compartilhar <b>→</b> "Adicionar à Tela de Início" <b>→</b> Adicionar.
      No Android: menu ⋮ do Chrome → "Adicionar à tela inicial".`,
  },
];
let onboardingPassoAtual = 0;

async function abrirOnboardingSeNecessario() {
  try {
    const snap = await getDoc(doc(bd, "usuarios", usuario.uid));
    if (snap.exists() && snap.data().onboardingVisto) return;
  } catch {
    return;
  }
  onboardingPassoAtual = 0;
  renderOnboarding();
  $("#overlay-onboarding").classList.remove("hidden");
}
function renderOnboarding() {
  const passo = ONBOARDING_PASSOS[onboardingPassoAtual];
  $("#onboarding-conteudo").innerHTML = `
    <div class="onboarding-slide-icone">${passo.icone}</div>
    <div class="onboarding-slide-titulo">${passo.titulo}</div>
    <div class="onboarding-slide-corpo">${passo.corpo}</div>`;
  $("#onboarding-pontos").innerHTML = ONBOARDING_PASSOS.map((_, i) => `<span class="${i === onboardingPassoAtual ? "ativo" : ""}"></span>`).join("");
  $("#btn-onboarding-voltar").classList.toggle("hidden", onboardingPassoAtual === 0);
  $("#btn-onboarding-proximo").textContent = onboardingPassoAtual === ONBOARDING_PASSOS.length - 1 ? "Concluir" : "Próximo";
}
async function concluirOnboarding() {
  $("#overlay-onboarding").classList.add("hidden");
  try {
    await updateDoc(doc(bd, "usuarios", usuario.uid), { onboardingVisto: true });
  } catch {
    /* se falhar, o onboarding só reaparece no próximo login — sem impacto no uso do app */
  }
}

// Ao rolar a tela de Início, a saudação some suavemente; o restante (cards, dashboard)
// continua visível — mesmo efeito usado no Controle Financeiro.
function observarSaudacao() {
  const saudacao = document.querySelector("#tela-inicio .saudacao");
  const raiz = document.querySelector("#tela-inicio main");
  if (!saudacao || !raiz || !("IntersectionObserver" in window)) return;
  const observador = new IntersectionObserver(
    ([entrada]) => { saudacao.style.opacity = entrada.intersectionRatio < 0.4 ? "0" : "1"; },
    { root: raiz, threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] }
  );
  observador.observe(saudacao);
}

// Lupa flutuante das telas de cadastro: abre/fecha o campo de busca e filtra a lista em tempo
// real a cada tecla digitada, sem precisar de um botão "buscar" separado.
function ligarBuscaCadastro(chave, idFab, idWrap, idInput, renderizar) {
  const fab = $(idFab), wrap = $(idWrap), input = $(idInput);
  fab.innerHTML = ICONE_LUPA;
  fab.onclick = () => {
    const abrindo = wrap.classList.contains("hidden");
    wrap.classList.toggle("hidden", !abrindo);
    fab.innerHTML = abrindo ? ICONE_FECHAR : ICONE_LUPA;
    if (abrindo) {
      input.focus();
    } else {
      input.value = "";
      termoBuscaCadastro[chave] = "";
      renderizar();
    }
  };
  input.addEventListener("input", () => {
    termoBuscaCadastro[chave] = input.value;
    renderizar();
  });
}

function ligarEventos() {
  $("#btn-entrar").onclick = entrar;
  $("#login-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
  $("#btn-esqueci").onclick = esqueciSenha;
  $("#btn-ir-cadastro").onclick = () => { $("#tela-login").classList.add("hidden"); $("#tela-cadastro").classList.remove("hidden"); };
  $("#btn-ir-login").onclick = () => { $("#tela-cadastro").classList.add("hidden"); $("#tela-login").classList.remove("hidden"); };
  $("#btn-criar-conta").onclick = criarConta;

  $("#btn-menu").onclick = () => {
    if ($("#btn-menu").classList.contains("modo-voltar")) {
      voltarParaTelaAnterior();
    } else {
      abrirMenu();
    }
  };
  $("#overlay-menu").onclick = fecharMenu;
  $("#btn-topbar-inicio").onclick = () => irParaTela("inicio");
  document.querySelectorAll(".menu-item[data-tela]").forEach((item) => {
    item.onclick = () => {
      fecharMenu();
      irParaTela(item.dataset.tela);
    };
  });
  $("#menu-cadastros-toggle").onclick = alternarSubmenuCadastros;
  $("#btn-convidar-amigo").onclick = () => { fecharMenu(); convidarAmigo(); };
  $("#btn-atualizacao").onclick = () => { fecharMenu(); verificarAtualizacao(); };
  $("#btn-sair").onclick = () => {
    if (confirm("Tem certeza que deseja sair da sua conta?")) { fecharMenu(); signOut(auth); }
  };
  $("#topbar-avatar").onclick = abrirPerfil;
  $("#topbar-sino").onclick = abrirNotificacoes;
  $("#btn-limpar-notificacoes").onclick = limparTodasNotificacoes;

  $("#fab-inicio").onclick = alternarFabInicio;
  $("#fab-inicio-overlay").onclick = fecharFabInicio;
  document.querySelectorAll(".fab-opcao").forEach((btn) => {
    btn.onclick = () => {
      fecharFabInicio();
      if (btn.dataset.tipo === "lista") irParaTela("listas");
      else irParaTela("cadastro-itens");
    };
  });
  $("#fab-listas").onclick = abrirFormNovaLista;
  aplicarFiltroMesAtualListas();
  $("#btn-abrir-seletor-mes-ano").onclick = abrirSeletorMesAno;
  $("#overlay-seletor-mes-ano").addEventListener("click", (e) => { if (e.target.id === "overlay-seletor-mes-ano") fecharSeletorMesAno(); });
  $("#btn-seletor-ano-anterior").onclick = () => {
    if (modoSeletorAno) anoBaseSeletorAno -= ANOS_POR_PAGINA_SELETOR;
    else anoExibidoSeletorMesAno--;
    renderGradeSeletorMesAno();
  };
  $("#btn-seletor-ano-proximo").onclick = () => {
    if (modoSeletorAno) anoBaseSeletorAno += ANOS_POR_PAGINA_SELETOR;
    else anoExibidoSeletorMesAno++;
    renderGradeSeletorMesAno();
  };
  $("#seletor-mes-ano-ano-exibido").onclick = alternarModoAnoSeletor;
  $("#btn-seletor-mes-ano-este-mes").onclick = () => {
    const agora = new Date();
    escolherMesAnoListas(agora.getMonth() + 1, agora.getFullYear());
  };
  $("#fab-cadastro-itens").onclick = abrirFormNovoItem;
  $("#fab-cadastro-grupos").onclick = abrirFormNovoGrupo;
  $("#fab-cadastro-locais").onclick = abrirFormNovoLocal;
  $("#fab-cadastro-formas").onclick = abrirFormNovaForma;
  $("#fab-cadastro-unidades").onclick = abrirFormNovaUnidade;
  ligarBuscaCadastro("itens", "#fab-busca-itens", "#busca-itens-wrap", "#busca-itens", renderCadastroItens);
  ligarBuscaCadastro("grupos", "#fab-busca-grupos", "#busca-grupos-wrap", "#busca-grupos", renderCadastroGrupos);
  ligarBuscaCadastro("locais", "#fab-busca-locais", "#busca-locais-wrap", "#busca-locais", renderCadastroLocais);
  ligarBuscaCadastro("formas", "#fab-busca-formas", "#busca-formas-wrap", "#busca-formas", renderCadastroFormas);
  ligarBuscaCadastro("unidades", "#fab-busca-unidades", "#busca-unidades-wrap", "#busca-unidades", renderCadastroUnidades);

  // "Itens pendentes" mostra a contagem da mesma lista selecionada no carrossel de cima — clicar
  // em qualquer um dos dois cards abre essa lista.
  const abrirListaProximaSelecionada = () => {
    const id = $("#mini-carrossel-proxima").dataset.idSelecionado;
    const lista = id && listasAtuais.find((l) => l.id === id);
    if (lista) abrirListaDetalhe(lista);
    else irParaTela("listas");
  };
  $("#card-lista-proxima").onclick = abrirListaProximaSelecionada;
  $("#card-itens-pendentes").onclick = abrirListaProximaSelecionada;

  $("#btn-salvar-lista").onclick = salvarLista;
  $("#btn-reabrir-lista-editar").onclick = async () => {
    const lista = listasAtuais.find((l) => l.id === $("#fn-id").value);
    await reabrirLista();
    if (lista) abrirListaDetalhe(lista);
  };
  $("#btn-excluir-lista").onclick = excluirListaAtual;
  $("#btn-cancelar-lista").onclick = voltarParaTelaAnterior;

  $("#ld-item-nome").addEventListener("input", (e) => {
    $("#ld-item-id").value = "";
    valorUnitarioAdicionarItem = 0;
    $("#ld-valor-provisionado").value = "";
    renderSugestoesItemLista(e.target.value);
  });
  $("#ld-item-nome").addEventListener("blur", () => setTimeout(() => $("#ld-item-sugestoes").classList.add("hidden"), 150));
  $("#ld-quantidade").addEventListener("input", atualizarValorAdicionarItem);
  $("#btn-adicionar-item-lista").onclick = adicionarItemNaLista;
  $("#btn-cancelar-add-item-lista").onclick = fecharFormAdicionarItem;
  $("#btn-abrir-form-add-item").onclick = () => {
    $("#btn-abrir-form-add-item").classList.add("hidden");
    $("#form-adicionar-item").classList.remove("hidden");
    $("#ld-item-nome").focus();
    atualizarBtnFinalizarCompra();
  };
  // Clicar fora do formulário de adicionar item (com ele aberto) equivale a desistir: recolhe de volta pra linha.
  // Usa composedPath() (caminho capturado no momento do clique) em vez de e.target: escolher uma
  // sugestão apaga o container (innerHTML = "") no mesmo clique, o que desconecta o elemento
  // clicado do documento — e um e.target desconectado sempre falha em form.contains(e.target).
  document.addEventListener("click", (e) => {
    const form = $("#form-adicionar-item");
    if (form.classList.contains("hidden")) return;
    const caminho = e.composedPath();
    if (caminho.includes(form) || caminho.includes($("#btn-abrir-form-add-item"))) return;
    fecharFormAdicionarItem();
  });
  ["nome", "valor"].forEach((tipo) => {
    $(`#btn-ordenar-lista-${tipo}`).onclick = () => {
      if (ordenacaoListaFinalizada === tipo) {
        direcaoOrdenacaoListaFinalizada = direcaoOrdenacaoListaFinalizada === "asc" ? "desc" : "asc";
      } else {
        ordenacaoListaFinalizada = tipo;
        // Valor começa do mais caro pro mais barato; nome começa de A a Z.
        direcaoOrdenacaoListaFinalizada = tipo === "valor" ? "desc" : "asc";
      }
      renderListaDetalhe();
    };
  });

  $("#btn-confirmar-compra").onclick = confirmarCompra;
  $("#btn-cancelar-compra").onclick = fecharModalComprar;
  $("#overlay-comprar").addEventListener("click", (e) => { if (e.target.id === "overlay-comprar") fecharModalComprar(); });

  $("#btn-confirmar-quantidade").onclick = confirmarQuantidade;
  $("#btn-cancelar-quantidade").onclick = fecharModalQuantidade;
  $("#overlay-quantidade").addEventListener("click", (e) => { if (e.target.id === "overlay-quantidade") fecharModalQuantidade(); });

  $("#ti-item-nome").addEventListener("input", (e) => renderSugestoesTrocarItem(e.target.value));
  $("#ti-item-nome").addEventListener("blur", () => setTimeout(() => $("#ti-item-sugestoes").classList.add("hidden"), 150));
  $("#btn-cancelar-trocar-item").onclick = fecharModalTrocarItem;
  $("#overlay-trocar-item").addEventListener("click", (e) => { if (e.target.id === "overlay-trocar-item") fecharModalTrocarItem(); });

  $("#btn-confirmar-finalizar").onclick = confirmarFinalizar;
  $("#btn-cancelar-finalizar").onclick = fecharModalFinalizar;
  $("#overlay-finalizar").addEventListener("click", (e) => { if (e.target.id === "overlay-finalizar") fecharModalFinalizar(); });

  $("#btn-fechar-detalhes-compra").onclick = fecharModalDetalhesCompra;
  $("#overlay-detalhes-compra").addEventListener("click", (e) => { if (e.target.id === "overlay-detalhes-compra") fecharModalDetalhesCompra(); });
  $("#btn-add-pagamento").onclick = () => {
    // Já sugere o restante a alocar como valor da nova linha — ex.: total R$800, R$500 já
    // preenchidos na primeira forma, a segunda já nasce com R$300 em vez de vazia.
    const restante = Math.max(Math.round((valorFinalFinalizar - totalAlocadoPagamentos()) * 100) / 100, 0);
    pagamentosFinalizar.push(novaLinhaPagamento("", restante > 0 ? formatarMoeda(restante) : ""));
    renderPagamentosFinalizar();
    atualizarRestantePagamentos();
  };

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("ativa", t === tab));
      $("#item-detalhe-info").classList.toggle("hidden", tab.dataset.tab !== "cadastro");
      $("#item-detalhe-imagem").classList.toggle("hidden", tab.dataset.tab !== "imagem");
      $("#item-detalhe-historico").classList.toggle("hidden", tab.dataset.tab !== "historico");
    };
  });

  $("#btn-salvar-item").onclick = salvarItem;
  $("#fi-nome").addEventListener("input", (e) => renderSugestoesItem(e.target.value));
  $("#fi-nome").addEventListener("blur", () => setTimeout(() => $("#fi-nome-sugestoes").classList.add("hidden"), 150));
  $("#fi-grupo-nome").addEventListener("input", (e) => { $("#fi-grupo-id").value = ""; renderSugestoesGrupo(e.target.value); });
  $("#fi-grupo-nome").addEventListener("focus", (e) => renderSugestoesGrupo(e.target.value));
  $("#fi-grupo-nome").addEventListener("blur", () => setTimeout(() => $("#fi-grupo-sugestoes").classList.add("hidden"), 150));
  $("#fi-unidade").addEventListener("input", (e) => renderSugestoesUnidade(e.target.value));
  $("#fi-unidade").addEventListener("focus", (e) => renderSugestoesUnidade(e.target.value));
  $("#fi-unidade").addEventListener("blur", () => setTimeout(() => $("#fi-unidade-sugestoes").classList.add("hidden"), 150));
  $("#fi-local-nome").addEventListener("input", (e) => { $("#fi-local-id").value = ""; renderSugestoesLocalItem(e.target.value); });
  $("#fi-local-nome").addEventListener("focus", (e) => renderSugestoesLocalItem(e.target.value));
  $("#fi-local-nome").addEventListener("blur", () => setTimeout(() => $("#fi-local-sugestoes").classList.add("hidden"), 150));
  $("#btn-excluir-item").onclick = excluirItemAtual;
  $("#btn-cancelar-item").onclick = voltarParaTelaAnterior;

  $("#btn-salvar-grupo").onclick = salvarGrupo;
  $("#btn-excluir-grupo").onclick = excluirGrupoAtual;
  $("#btn-cancelar-grupo").onclick = voltarParaTelaAnterior;

  $("#btn-salvar-local").onclick = salvarLocal;
  $("#btn-abrir-site-local").onclick = () => {
    const site = $("#fl-site").value.trim();
    if (site) window.open(site, "_blank", "noopener");
  };
  $("#btn-excluir-local").onclick = excluirLocalAtual;
  $("#btn-cancelar-local").onclick = voltarParaTelaAnterior;

  $("#btn-salvar-forma").onclick = salvarForma;
  $("#btn-excluir-forma").onclick = excluirFormaAtual;
  $("#btn-cancelar-forma").onclick = voltarParaTelaAnterior;

  $("#btn-salvar-unidade").onclick = salvarUnidade;
  $("#btn-excluir-unidade").onclick = excluirUnidadeAtual;
  $("#btn-cancelar-unidade").onclick = voltarParaTelaAnterior;

  $("#btn-convidar").onclick = convidarParaEspaco;

  $("#btn-salvar-perfil").onclick = salvarPerfil;
  $("#btn-salvar-seguranca").onclick = alterarSenha;
  $("#btn-cancelar-perfil").onclick = () => irParaTela(telaAnterior);
  $("#pf-telefone").addEventListener("input", (e) => { e.target.value = formatarTelefone(e.target.value); });
  $("#cad-telefone").addEventListener("input", (e) => { e.target.value = formatarTelefone(e.target.value); });
  $("#pf-foto-input").addEventListener("change", (e) => { const a = e.target.files?.[0]; if (a) salvarFotoPerfil(a); });
  $("#det-foto-input-camera").addEventListener("change", (e) => { const a = e.target.files?.[0]; if (a) salvarFotoItemDetalhe(a, "#det-label-foto-camera"); e.target.value = ""; });
  $("#det-foto-input-galeria").addEventListener("change", (e) => { const a = e.target.files?.[0]; if (a) salvarFotoItemDetalhe(a, "#det-label-foto-galeria"); e.target.value = ""; });
  $("#btn-remover-foto-det").addEventListener("click", async () => {
    if (!itemCatalogoAbertoId) return;
    await updateDoc(doc(bd, "espacos", espacoIdAtual, "itens", itemCatalogoAbertoId), { fotoUrl: null });
    renderImagemItemDetalhe(null);
  });
  $("#btn-confirmar-enviar-lista").onclick = confirmarEnvioParaLista;
  $("#btn-cancelar-enviar-lista").onclick = fecharPickerEnviarLista;

  const chaveTema = $("#chave-tema-escuro");
  const temaEscuroSalvo = document.documentElement.getAttribute("data-tema") === "escuro";
  chaveTema.setAttribute("aria-checked", String(temaEscuroSalvo));
  chaveTema.classList.toggle("ligada", temaEscuroSalvo);
  chaveTema.onclick = () => {
    const escuro = chaveTema.getAttribute("aria-checked") !== "true";
    chaveTema.setAttribute("aria-checked", String(escuro));
    chaveTema.classList.toggle("ligada", escuro);
    try { localStorage.setItem("temaEscuro", String(escuro)); } catch {}
    aplicarTema(escuro);
  };
  ["#mc-valor", "#fi-valor", "#fin-desconto"].forEach(ligarMascaraMoeda);
  $("#mc-valor").addEventListener("input", () => {
    atualizarDiferencaValorComprar();
    atualizarLegendaValorTotalComprar();
  });
  $("#mc-quantidade").addEventListener("input", atualizarLegendaValorTotalComprar);
  $("#fin-desconto").addEventListener("input", atualizarValorFinalFinalizar);
  ["#ld-quantidade"].forEach(bloquearCaracteresInvalidosNumero);
  ["#ld-quantidade", "#qtd-valor", "#env-quantidade"].forEach(bloquearDecimalSeNaoFracionavel);
  // Botões "−"/"+" dos campos de quantidade: sempre andam de 1 em 1 (mesmo em unidade
  // fracionável, ex.: kg) — decimais só entram digitando manualmente no campo. Um passo por
  // toque, sem o spinner nativo repetindo incrementos sozinho em telas de toque.
  document.querySelectorAll(".btn-stepper").forEach((btn) => {
    btn.onclick = () => {
      const input = $(`#${btn.dataset.alvo}`);
      if (!input) return;
      const minimo = input.min !== "" ? Number(input.min) : -Infinity;
      let valor = Math.round(((Number(input.value) || 0) + Number(btn.dataset.delta)) * 100) / 100;
      if (valor < minimo) valor = minimo;
      input.value = valor;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
  });
  renderOpcoesValorProvisionado();
  renderOpcoesPeriodoDashboard();
  $("#btn-toggle-nomes-dashboard").onclick = alternarPrivacidadeDashboard;

  $("#btn-onboarding-proximo").onclick = () => {
    if (onboardingPassoAtual === ONBOARDING_PASSOS.length - 1) concluirOnboarding();
    else { onboardingPassoAtual++; renderOnboarding(); }
  };
  $("#btn-onboarding-voltar").onclick = () => { onboardingPassoAtual = Math.max(0, onboardingPassoAtual - 1); renderOnboarding(); };
  $("#btn-onboarding-pular").onclick = concluirOnboarding;
}
