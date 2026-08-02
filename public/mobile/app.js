import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, signOut, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  query, where, serverTimestamp, writeBatch, increment, arrayUnion,
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
function ligarMascaraMoeda(seletor) {
  $(seletor).addEventListener("input", (e) => {
    const digitos = e.target.value.replace(/\D/g, "");
    e.target.value = digitos ? formatarMoeda(Number(digitos) / 100) : "";
  });
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
const LOCAIS_PADRAO = ["Supermercados BH", "Villefort", "Mart Minas", "Center Pão"]
  .map((nome) => ({ nome, endereco: null, cidade: null }));
const FORMAS_PADRAO = ["PIX", "Dinheiro", "Cartão de Débito", "Cartão de Crédito", "Flash"]
  .map((nome) => ({ nome }));
const UNIDADES_PADRAO = [
  { nome: "Bandeja", fracionavel: false }, { nome: "Caixa", fracionavel: false }, { nome: "Dúzia", fracionavel: false },
  { nome: "Fardo", fracionavel: false }, { nome: "Frasco", fracionavel: false }, { nome: "Garrafa", fracionavel: false },
  { nome: "Gramas", fracionavel: true }, { nome: "Kg", fracionavel: true }, { nome: "Lata", fracionavel: false },
  { nome: "ml", fracionavel: true }, { nome: "Rolo", fracionavel: false }, { nome: "Saco", fracionavel: false },
  { nome: "Unidade", fracionavel: false },
];
const ICONE_CALENDARIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" style="vertical-align:-1px;margin-right:3px"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v3.2M16 3v3.2"/></svg>';
const ICONE_SITE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 4 5.7 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.7-4-9s1.5-6.5 4-9Z"/></svg>';

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
let itemCatalogoAbertoId = null;
let itemListaPendenteId = null;
let ultimoLocalUsadoId = null;
let telaAnterior = "inicio";
let filtroGrupoLista = null, filtroLocalLista = null, filtroGrupoItens = null;
let fracionavelUnidadeSelecionado = null;

let unsubUsuario = null, unsubEspacoDoc = null, unsubGrupos = null, unsubLocais = null,
  unsubFormas = null, unsubUnidades = null, unsubItens = null, unsubListas = null, unsubItensLista = null, unsubConvites = null,
  unsubNotificacoes = null;

/* ---------- inicialização ---------- */
window.addEventListener("DOMContentLoaded", () => {
  ligarEventos();

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
});

/* ---------- login / cadastro ---------- */
function mostrarMsg(seletor, texto, tipo) {
  const el = $(seletor);
  el.textContent = texto;
  el.className = texto ? `aviso ${tipo || ""}` : "";
}

let timeoutToastSucesso = null;
function exibirSucesso(texto) {
  $("#toast-sucesso-texto").textContent = texto;
  $("#toast-sucesso").classList.remove("hidden");
  clearTimeout(timeoutToastSucesso);
  timeoutToastSucesso = setTimeout(() => {
    $("#toast-sucesso").classList.add("hidden");
  }, 2000);
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
  } catch (e) {
    console.error("garantirCatalogoSemeado falhou:", e);
  } finally {
    espacosSemeandoEmAndamento.delete(espacoId);
  }
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
    renderLocaisMaisBaratos();
  });
  unsubFormas = onSnapshot(collection(bd, "espacos", espacoId, "formasPagamento"), (snap) => {
    formasAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    preencherSelectFormaPagamento();
    renderCadastroFormas();
  });
  unsubUnidades = onSnapshot(collection(bd, "espacos", espacoId, "unidadesMedida"), (snap) => {
    unidadesAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    renderCadastroUnidades();
  });
  unsubItens = onSnapshot(collection(bd, "espacos", espacoId, "itens"), (snap) => {
    itensAtuais = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    renderCadastroItens();
    renderDashboard();
    renderLocaisMaisBaratos();
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
async function redimensionarImagem(arquivo, tamanhoMax) {
  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, tamanhoMax / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, largura, altura);
  return canvas.toDataURL("image/jpeg", 0.8);
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
  $("#fin-forma").innerHTML = formasAtuais.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join("");
}
// Nenhuma sugestão aparece até o usuário digitar — nada vem pré-selecionado, diferente de um
// <select> nativo (que sempre mostra/seleciona a primeira opção por padrão).
function renderSugestoesItemLista(query) {
  const container = $("#ld-item-sugestoes");
  const termo = query.trim().toLowerCase();
  const encontrados = termo.length < 1 ? [] : itensAtuais.filter((i) => i.nome.toLowerCase().includes(termo)).slice(0, 6);

  if (encontrados.length === 0) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  container.innerHTML = encontrados
    .map((i) => {
      const detalhe = [i.marca, i.descricao, i.descricaoUnidade].filter(Boolean).join(" · ");
      return `<div class="autocomplete-item" data-id="${i.id}"><span>${esc(i.nome)}</span><span class="grupo">${esc(detalhe)}</span></div>`;
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
      container.classList.add("hidden");
      container.innerHTML = "";
    };
  });
}

/* ---------- dashboard (Início) ---------- */
function renderDashboard() {
  const pendentes = listasAtuais.filter((l) => l.status !== "comprada" || l.permanente);
  const valorProvisionado = pendentes.reduce((s, l) => s + (l.valorProvisionadoTotal || 0), 0);
  $("#dash-valor-provisionado").textContent = formatarMoeda(valorProvisionado);

  renderCarrosselProximaCompra(pendentes);
  renderLocaisMaisBaratos();

  getDoc(doc(bd, "espacos", espacoIdAtual, "estatisticas", "geral")).then((snap) => {
    const geral = snap.exists() ? snap.data() : {};
    renderRankingDashboard("#dash-itens-mais", geral.itens || {}, (id) => itensAtuais.find((i) => i.id === id)?.nome || id);
    renderRankingDashboard("#dash-grupos-mais", geral.grupos || {}, (nome) => nome, "#dash-barra-grupos");
    renderRankingDashboard("#dash-locais-mais", geral.locais || {}, (id) => locaisAtuais.find((l) => l.id === id)?.nome || id);
  }).catch(() => {});
}

// Carrossel de listas pendentes no card "Lembrete de Compras": arrastando entre as listas, o
// card "Itens pendentes" acompanha qual delas está visível no momento. Uma lista some do
// carrossel assim que vira "comprada" (deixa de fazer parte de `pendentes`, vindo de fora).
function renderCarrosselProximaCompra(pendentes) {
  const ordenadas = [...pendentes].sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
  const carrossel = $("#mini-carrossel-proxima");
  const pontos = $("#mini-carrossel-pontos");

  if (ordenadas.length === 0) {
    carrossel.innerHTML = `<div class="mini-carrossel-slide" style="color:var(--muted);font-weight:500;font-size:13px">Nenhuma</div>`;
    pontos.innerHTML = "";
    delete carrossel.dataset.idSelecionado;
    $("#dash-itens-pendentes").textContent = "0";
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
    pontos.querySelectorAll("span").forEach((s, i) => s.classList.toggle("ativo", i === idx));
    carrossel.dataset.idSelecionado = lista.id;
  }

  let timeoutScrollProxima = null;
  carrossel.onscroll = () => {
    clearTimeout(timeoutScrollProxima);
    timeoutScrollProxima = setTimeout(atualizarSelecao, 80);
  };
  atualizarSelecao();
}

const CORES_RANKING = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#9333ea", "#0891b2"];
function renderRankingDashboard(seletorLista, mapa, resolverNome, seletorBarra) {
  const entradas = Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = entradas.reduce((s, [, v]) => s + v, 0);
  const container = $(seletorLista);
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

/* ---------- carrossel de listas ---------- */
function renderCarrosselListas() {
  const container = $("#carrossel-listas");
  if (listasAtuais.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhuma lista ainda. Toque em “+” para criar a primeira.</div>`;
    return;
  }
  const ordenadas = [...listasAtuais].sort((a, b) => (a.criadoEm?.toMillis?.() || 0) - (b.criadoEm?.toMillis?.() || 0));
  container.innerHTML = ordenadas
    .map((l) => {
      const status = l.status || "pendente";
      const rotuloStatus = { pendente: "Pendente", parcial: "Compra parcial", comprada: "Comprada" }[status];
      const comprados = l.qtdComprados || 0;
      const pendentes = Math.max((l.qtdItens || 0) - comprados, 0);
      return `<div class="card-lista status-${status}" data-id="${l.id}">
        <div class="card-lista-topo">
          <div>
            <div class="card-lista-titulo">${esc(l.nome)}</div>
            ${l.finalizadaEm ? `<div class="card-lista-obs">${ICONE_CALENDARIO}Concluída em ${formatarDataHoraBR(l.finalizadaEm)}</div>` : ""}
            ${l.observacoes ? `<div class="card-lista-obs">${esc(l.observacoes)}</div>` : ""}
          </div>
          <span class="badge-status ${status}">${l.permanente ? "Permanente" : rotuloStatus}</span>
        </div>
        <div class="card-lista-rodape">
          <span>${comprados}/${l.qtdItens || 0} itens</span>
          <span class="valor">${formatarMoeda(l.valorProvisionadoTotal || 0)}</span>
        </div>
        <div class="card-lista-resumo-itens">
          <span>✅ ${comprados} comprado${comprados === 1 ? "" : "s"}</span>
          <span>🔲 ${pendentes} pendente${pendentes === 1 ? "" : "s"}</span>
        </div>
      </div>`;
    })
    .join("");
  container.querySelectorAll(".card-lista").forEach((el) => {
    el.onclick = () => abrirListaDetalhe(listasAtuais.find((l) => l.id === el.dataset.id));
  });
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
  $("#btn-salvar-lista").disabled = true;
  try {
    if (id) {
      await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", id), { nome, observacoes, permanente });
    } else {
      await addDoc(collection(bd, "espacos", espacoIdAtual, "listas"), {
        nome, observacoes, permanente,
        status: "pendente", qtdItens: 0, qtdComprados: 0, valorProvisionadoTotal: 0,
        criadoPor: usuario.uid, criadoEm: serverTimestamp(),
        finalizadaEm: null, formaPagamentoId: null, parcelas: null, valorTotalPago: null,
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
async function excluirListaAtual() {
  const id = $("#fn-id").value;
  if (!id || !confirm("Excluir esta lista e todos os seus itens?")) return;
  const itensSnap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", id, "itensLista"));
  await Promise.all(itensSnap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(bd, "espacos", espacoIdAtual, "listas", id));
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
  filtroLocalLista = null;
  ultimoLocalUsadoId = null;
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

// "Convidar Amigo" no menu: usa o share sheet nativo do celular quando disponível (deixa a
// pessoa escolher WhatsApp, SMS, e-mail etc.); em navegador sem suporte, cai pro link do WhatsApp.
function convidarAmigo() {
  const link = `${window.location.origin}/mobile`;
  const texto = `🛒 Estou usando este app de lista de compras compartilhada e achei muito prático! Com ele podemos criar listas em conjunto, acompanhar alterações em tempo real, comparar preços entre mercados e controlar o que já foi comprado ou ainda está pendente. Experimente! ${link}`;
  if (navigator.share) {
    navigator.share({ title: "Listo", text: texto, url: link }).catch(() => {});
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
  }
}

function compartilharListaWhatsApp() {
  const lista = listaAbertaAtual();
  if (!lista) return;
  const linhas = [...itensListaAtuais]
    .sort((a, b) => (a.grupoNome || "").localeCompare(b.grupoNome || "") || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((i) => `${i.comprado ? "✅" : "🔲"} ${i.nome} - ${i.quantidade}${i.unidade ? ` ${i.unidade}` : ""}`)
    .join("\n");
  const texto = `🛒 *${lista.nome}*\n\n${linhas || "Nenhum item ainda."}\n\nTotal previsto: ${formatarMoeda(lista.valorProvisionadoTotal || 0)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
}

function renderListaDetalhe() {
  const lista = listaAbertaAtual();
  if (!lista) return;

  const status = lista.status || "pendente";
  const rotuloStatus = { pendente: "Pendente", parcial: "Compra parcial", comprada: "Comprada" }[status];

  const gruposDaLista = [...new Set(itensListaAtuais.map((i) => i.grupoNome).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  renderChips("#filtros-lista-grupo", gruposDaLista, filtroGrupoLista, (v) => { filtroGrupoLista = v; renderListaDetalhe(); });

  const locaisDaLista = [...new Set(itensListaAtuais.map((i) => i.localCompraId && (locaisAtuais.find((l) => l.id === i.localCompraId)?.nome)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  renderChips("#filtros-lista-local", locaisDaLista, filtroLocalLista, (v) => { filtroLocalLista = v; renderListaDetalhe(); });

  let itens = itensListaAtuais;
  if (filtroGrupoLista) itens = itens.filter((i) => i.grupoNome === filtroGrupoLista);
  if (filtroLocalLista) itens = itens.filter((i) => locaisAtuais.find((l) => l.id === i.localCompraId)?.nome === filtroLocalLista);

  // Contagem e total no cabeçalho seguem o filtro atual: com "Todos" é a lista inteira,
  // filtrando por grupo/local mostra só a fatia filtrada.
  const qtdComprados = itens.filter((i) => i.comprado).length;
  const valorTotal = itens.reduce((s, i) => s + (i.subtotal || 0), 0);
  $("#lista-detalhe-cabecalho").innerHTML = `
    <div class="detalhe-titulo-credor"><span class="detalhe-nome-lista">${esc(lista.nome)}</span><span class="badge-status ${status}">${lista.permanente ? "Permanente" : rotuloStatus}</span></div>
    <div class="card-lista-rodape" style="margin-bottom:6px">
      <span>${qtdComprados}/${itens.length} itens</span>
      <span class="valor">${formatarMoeda(valorTotal)}</span>
    </div>`;

  itens = [...itens].sort((a, b) => {
    if (a.comprado !== b.comprado) return a.comprado ? 1 : -1;
    return (a.grupoNome || "").localeCompare(b.grupoNome || "") || a.nome.localeCompare(b.nome, "pt-BR");
  });

  const espacoCompartilhado = (espacoAtual.membros || []).length > 1;

  const container = $("#itens-da-lista");
  if (itens.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhum item nesta lista ainda.</div>`;
  } else {
    container.innerHTML = itens
      .map((i) => `
      <div class="item ${i.comprado ? "comprado" : ""}" data-id="${i.id}">
        <button class="chk" data-acao="marcar">✓</button>
        <div class="info">
          <div class="nome">${esc(i.nome)}</div>
          <div class="detalhe"><button class="btn-qtd" data-acao="qtd">${i.quantidade}${i.unidade ? ` ${esc(i.unidade)}` : ""} ✎</button>${espacoCompartilhado && i.adicionadoPorNome ? `<span>· adicionado por ${esc(i.adicionadoPorNome)}</span>` : ""}</div>
        </div>
        <div class="valor-linha">
          <span class="valor-unitario">${formatarMoeda(i.valorProvisionado)}/un.</span>
          <span class="valor">${formatarMoeda(i.subtotal)}</span>
        </div>
        <button class="btn-excluir-linha" data-acao="excluir">✕</button>
      </div>`)
      .join("");
    container.querySelectorAll('[data-acao="marcar"]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const item = itensListaAtuais.find((i) => i.id === btn.closest(".item").dataset.id);
        if (item.comprado) desmarcarComprado(item);
        else abrirModalComprar(item.id);
      };
    });
    container.querySelectorAll('[data-acao="excluir"]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const id = btn.closest(".item").dataset.id;
        await deleteDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista", id));
        recalcularTotaisLista();
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

  $("#btn-finalizar-compra").classList.toggle("hidden", !(lista.qtdItens > 0 && !lista.permanente && !lista.finalizadaEm));
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
// Se nunca foi comprado (sem histórico), sempre fica em 0, independente da preferência.
async function valorProvisionadoParaItem(item) {
  const preferencia = preferenciaValorProvisionado();
  if (preferencia === "cadastro") return item.valor || 0;
  // "Último comprado"/"mais barato" só valem quando já existe histórico de fato; sem nenhuma
  // compra finalizada ainda, sempre cai no valor do cadastro (ou 0, se também não tiver).
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "itens", item.id, "historicoPrecos"));
  if (snap.empty) return item.valor || 0;
  const registros = snap.docs.map((d) => d.data());
  if (preferencia === "barato") {
    const valores = registros.map((r) => r.valor || 0).filter((v) => v > 0);
    return valores.length ? Math.min(...valores) : (item.valor || 0);
  }
  const maisRecente = registros.sort((a, b) => b.data.localeCompare(a.data))[0];
  return maisRecente.valor || (item.valor || 0);
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

function fecharFormAdicionarItem() {
  $("#ld-item-nome").value = "";
  $("#ld-item-id").value = "";
  $("#ld-unidade").value = "";
  $("#ld-quantidade").value = "1";
  configurarCampoQuantidade($("#ld-quantidade"), "");
  $("#ld-item-sugestoes").classList.add("hidden");
  $("#form-adicionar-item").classList.add("hidden");
  $("#btn-abrir-form-add-item").classList.remove("hidden");
}

async function adicionarItemNaLista() {
  const itemId = $("#ld-item-id").value;
  const item = itensAtuais.find((i) => i.id === itemId);
  if (!item) {
    exibirSucesso(itensAtuais.length === 0 ? "Cadastre um item antes de adicionar à lista." : "Digite o nome e selecione um item da lista de sugestões.");
    return;
  }
  // Campo nativo type="number": .value já vem com ponto decimal (não vírgula), então lê direto
  // em vez de usar paraNumero (que espera o formato "R$ 1.234,56" dos campos de valor).
  let quantidade = Number($("#ld-quantidade").value) || 1;
  if (!unidadeAceitaFracao(item.unidade)) quantidade = Math.round(quantidade);
  const valorProvisionado = await valorProvisionadoParaItem(item);
  const adicionadoPorNome = nomeExibicaoUsuario();
  await addDoc(collection(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista"), {
    itemId, nome: item.nome, unidade: item.unidade, grupoNome: item.grupoNome || null,
    quantidade, valorProvisionado, subtotal: quantidade * valorProvisionado,
    comprado: false, localCompraId: null, valorPago: null, compradoPor: null, compradoEm: null,
    adicionadoPor: usuario.uid, adicionadoPorNome,
  });
  recalcularTotaisLista();
  const listaAtual = listaAbertaAtual();
  notificarMembrosEspaco(`${adicionadoPorNome} adicionou "${item.nome}" à lista "${listaAtual?.nome || ""}".`);
  fecharFormAdicionarItem();
  exibirSucesso("Item adicionado à lista!");
}

// Busca os itens direto do servidor (getDocs) em vez de usar itensListaAtuais: logo após um
// addDoc/updateDoc/deleteDoc, o listener onSnapshot pode ainda não ter atualizado o cache local,
// e os totais ficariam errados se lêssemos o array em memória nesse instante.
async function recalcularTotaisLista(listaId = listaAbertaId) {
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", listaId, "itensLista"));
  const itens = snap.docs.map((d) => d.data());
  const qtdItens = itens.length;
  const qtdComprados = itens.filter((i) => i.comprado).length;
  const valorProvisionadoTotal = itens.reduce((s, i) => s + (i.subtotal || 0), 0);
  const status = qtdComprados === 0 ? "pendente" : qtdComprados === qtdItens && qtdItens > 0 ? "comprada" : "parcial";
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaId), { qtdItens, qtdComprados, valorProvisionadoTotal, status });
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
    quantidade, subtotal: quantidade * (item.valorProvisionado || 0),
  });
  await recalcularTotaisLista();
  fecharModalQuantidade();
  exibirSucesso("Quantidade atualizada!");
}

/* ---------- marcar item como comprado (modal local + valor) ---------- */
function abrirModalComprar(itemListaId) {
  itemListaPendenteId = itemListaId;
  $("#mc-valor").value = "";
  // Lembra o último local usado nesta sessão de compras: assim só falta informar o valor a cada item.
  if (ultimoLocalUsadoId) $("#mc-local").value = ultimoLocalUsadoId;
  mostrarMsg("#msg-comprar", "", "");
  $("#overlay-comprar").classList.remove("hidden");
}
function fecharModalComprar() {
  $("#overlay-comprar").classList.add("hidden");
  itemListaPendenteId = null;
}
async function confirmarCompra() {
  const localId = $("#mc-local").value;
  const valorPago = paraNumero($("#mc-valor").value);
  if (!localId || valorPago <= 0) {
    mostrarMsg("#msg-comprar", "Selecione o local e informe o valor pago.", "erro");
    return;
  }
  const item = itensListaAtuais.find((i) => i.id === itemListaPendenteId);
  if (!item) return;
  ultimoLocalUsadoId = localId;
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista", item.id), {
    comprado: true, localCompraId: localId, valorPago, compradoPor: usuario.uid, compradoEm: hojeISO(),
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
  });
  recalcularTotaisLista();
}

/* ---------- finalizar compra ---------- */
// Total real da compra: soma do que foi de fato pago nos itens já marcados (quantidade × valor
// pago), nunca o valor provisionado dos itens ainda pendentes — por isso o campo é travado.
function calcularTotalItensComprados(itens) {
  return itens.filter((i) => i.comprado).reduce((s, i) => s + (i.quantidade || 0) * (i.valorPago ?? i.valorProvisionado ?? 0), 0);
}
function abrirModalFinalizar() {
  $("#fin-parcelas").value = "1";
  $("#fin-parcelas-wrap").classList.add("hidden");
  const lista = listaAbertaAtual();
  $("#fin-valor-total").value = formatarMoeda(calcularTotalItensComprados(itensListaAtuais));
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
  const formaId = $("#fin-forma").value;
  if (!formaId) {
    mostrarMsg("#msg-finalizar", "Selecione a forma de pagamento.", "erro");
    return;
  }
  // Grava o histórico de preços agora (não no check individual): só os itens efetivamente
  // marcados como comprados entram; os pendentes simplesmente mantêm o histórico anterior.
  const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "listas", listaAbertaId, "itensLista"));
  const todosItens = snap.docs.map((d) => d.data());
  const valorTotalPago = calcularTotalItensComprados(todosItens);
  if (valorTotalPago <= 0) {
    mostrarMsg("#msg-finalizar", "Nenhum item foi marcado como comprado ainda.", "erro");
    return;
  }
  if (!confirm("Deseja realmente finalizar esta compra?")) return;
  const forma = formasAtuais.find((f) => f.id === formaId);
  const parcelas = forma?.nome === "Cartão de Crédito" ? Number($("#fin-parcelas").value) || 1 : 1;
  const comprados = todosItens.filter((i) => i.comprado && i.valorPago > 0 && i.localCompraId);
  await Promise.all(comprados.map((i) => addDoc(collection(bd, "espacos", espacoIdAtual, "itens", i.itemId, "historicoPrecos"), {
    localId: i.localCompraId, valor: i.valorPago, data: i.compradoEm || hojeISO(), listaId: listaAbertaId,
  })));
  // Estatísticas dos dashboards (itens/grupos/locais mais usados) contam só o que foi de fato
  // finalizado — soma as ocorrências por chave e grava um único increment por chave.
  if (comprados.length > 0) {
    const contagemItens = {}, contagemGrupos = {}, contagemLocais = {};
    comprados.forEach((i) => {
      contagemItens[i.itemId] = (contagemItens[i.itemId] || 0) + 1;
      const grupo = i.grupoNome || "Outros";
      contagemGrupos[grupo] = (contagemGrupos[grupo] || 0) + 1;
      contagemLocais[i.localCompraId] = (contagemLocais[i.localCompraId] || 0) + 1;
    });
    await setDoc(doc(bd, "espacos", espacoIdAtual, "estatisticas", "geral"), {
      itens: Object.fromEntries(Object.entries(contagemItens).map(([k, v]) => [k, increment(v)])),
      grupos: Object.fromEntries(Object.entries(contagemGrupos).map(([k, v]) => [k, increment(v)])),
      locais: Object.fromEntries(Object.entries(contagemLocais).map(([k, v]) => [k, increment(v)])),
    }, { merge: true });
  }
  await updateDoc(doc(bd, "espacos", espacoIdAtual, "listas", listaAbertaId), {
    finalizadaEm: serverTimestamp(), formaPagamentoId: formaId, parcelas, valorTotalPago,
  });
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

function renderCadastroItens() {
  renderChipsFiltroGrupo();
  let lista = itensAtuais;
  if (filtroGrupoItens) lista = lista.filter((i) => i.grupoNome === filtroGrupoItens);
  const container = $("#lista-cadastro-itens");
  if (lista.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhum item cadastrado.</div>`;
    return;
  }
  container.innerHTML = lista
    .map((i) => {
      const partes = [i.marca, i.descricao, i.descricaoUnidade].filter(Boolean);
      const detalhe = partes.map((p, idx) => `<span>${idx === 0 ? "" : "· "}${esc(p)}</span>`).join("");
      return `<div class="item" data-id="${i.id}">
      <div class="info">
        <div class="nome">${esc(i.nome)}</div>
        <div class="detalhe">${detalhe}</div>
      </div>
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
async function abrirPickerEnviarLista(item) {
  if (!item) return;
  $("#titulo-enviar-lista").textContent = `Enviar "${item.nome}" para qual lista?`;
  $("#env-quantidade").value = "1";
  configurarCampoQuantidade($("#env-quantidade"), item.unidade);
  const pendentes = listasAtuais.filter((l) => l.status !== "comprada" || l.permanente);
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
  container.innerHTML = pendentes
    .map((l, idx) => jaNaLista[idx]
      ? `<button class="btn-secundario opcao-lista-enviar" data-lista-id="${l.id}" disabled style="width:100%;margin-bottom:8px;text-align:left;opacity:.5;cursor:not-allowed">${esc(item.nome)} já está na lista "${esc(l.nome)}"</button>`
      : `<button class="btn-secundario opcao-lista-enviar" data-lista-id="${l.id}" style="width:100%;margin-bottom:8px;text-align:left">${esc(l.nome)}</button>`)
    .join("");
  container.querySelectorAll(".opcao-lista-enviar:not([disabled])").forEach((btn) => {
    btn.onclick = () => enviarItemParaLista(item, btn.dataset.listaId);
  });
}
function fecharPickerEnviarLista() {
  $("#overlay-enviar-lista").classList.add("hidden");
  mostrarMsg("#msg-enviar-lista", "", "");
}
async function enviarItemParaLista(item, listaId) {
  // Checagem de segurança contra corrida (ex: enviado por outro dispositivo entre abrir o picker e clicar).
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
    itemId: item.id, nome: item.nome, unidade: item.unidade, grupoNome: item.grupoNome || null,
    quantidade, valorProvisionado, subtotal: quantidade * valorProvisionado,
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
    const dataUrl = await redimensionarImagem(arquivo, 480);
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
  $("#item-detalhe-info").innerHTML =
    [
      ["Nome", item.nome],
      ["Marca", item.marca || "—"],
      ["Descrição", item.descricao || "—"],
      ["Descrição da unidade", item.descricaoUnidade || "—"],
      ["Valor", item.valor ? formatarMoeda(item.valor) : "—"],
      ["Grupo", item.grupoNome || "—"],
      ["Unidade", item.unidade],
    ].map(([r, v]) => `<div class="detalhe-linha"><span class="rotulo">${esc(r)}</span><span class="valor-detalhe">${esc(String(v))}</span></div>`).join("") +
    `<button class="btn-secundario" id="btn-editar-item-catalogo" style="margin-top:14px">✏️ Editar item</button>`;
  $("#btn-editar-item-catalogo").onclick = () => abrirFormEditarItem(item);
  renderImagemItemDetalhe(item.fotoUrl || null);

  await renderHistoricoItem(item);

  mostrarTelaCheia("item-detalhe", item.nome);
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
  $("#tabela-historico").innerHTML = ultimos.length
    ? ultimos.map((h) => `<div class="linha-historico">
        <span class="local">${esc(locaisAtuais.find((l) => l.id === h.localId)?.nome || "—")}</span>
        <span class="valor">${formatarMoeda(h.valor)}</span>
        <span class="data">${formatarDataBR(h.data)}</span>
        <button class="btn-excluir-historico" data-local-id="${h.localId}" aria-label="Excluir registro">🗑️</button>
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
  $("#fi-id").value = "";
  $("#fi-nome").value = "";
  $("#fi-descricao").value = "";
  $("#fi-descricao-unidade").value = "";
  $("#fi-valor").value = "";
  $("#fi-marca").value = "";
  $("#fi-grupo-nome").value = "";
  $("#fi-grupo-id").value = "";
  $("#fi-unidade").value = "";
  $("#btn-excluir-item").classList.add("hidden");
  $("#fi-nome-sugestoes").classList.add("hidden");
  $("#fi-grupo-sugestoes").classList.add("hidden");
  $("#fi-unidade-sugestoes").classList.add("hidden");
  mostrarMsg("#msg-form-item", "", "");
  mostrarTelaCheia("form-item", "Novo item");
}

// Grupo e Unidade são listas pequenas e fechadas — ao focar o campo vazio, mostra todas as
// opções cadastradas (não precisa digitar nada pra escolher); nunca vem pré-selecionado, só
// conta como escolhido ao clicar numa sugestão.
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

// Sugere itens já cadastrados que combinam com o que está sendo digitado, pra evitar duplicar
// o mesmo produto no catálogo. Clicar numa sugestão abre o item existente para editar.
function renderSugestoesItem(query) {
  const container = $("#fi-nome-sugestoes");
  const termo = query.trim().toLowerCase();
  const idAtual = $("#fi-id").value;
  const encontrados = termo.length < 2
    ? []
    : itensAtuais.filter((i) => i.id !== idAtual && i.nome.toLowerCase().includes(termo)).slice(0, 6);

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
function abrirFormEditarItem(item) {
  telaAnterior = "cadastro-itens";
  $("#fi-id").value = item.id;
  $("#fi-nome").value = item.nome;
  $("#fi-descricao").value = item.descricao || "";
  $("#fi-descricao-unidade").value = item.descricaoUnidade || "";
  $("#fi-valor").value = item.valor ? formatarMoeda(item.valor) : "";
  $("#fi-marca").value = item.marca || "";
  $("#fi-unidade").value = item.unidade;
  $("#fi-grupo-nome").value = item.grupoNome || "";
  $("#fi-grupo-id").value = item.grupoId || "";
  $("#btn-excluir-item").classList.remove("hidden");
  $("#fi-nome-sugestoes").classList.add("hidden");
  $("#fi-grupo-sugestoes").classList.add("hidden");
  $("#fi-unidade-sugestoes").classList.add("hidden");
  mostrarMsg("#msg-form-item", "", "");
  mostrarTelaCheia("form-item", "Editar item");
}
async function salvarItem() {
  const id = $("#fi-id").value;
  const nome = $("#fi-nome").value.trim();
  const grupoId = $("#fi-grupo-id").value;
  const grupoNome = gruposAtuais.find((g) => g.id === grupoId)?.nome || null;
  const unidade = unidadesAtuais.find((u) => u.nome.toLowerCase() === $("#fi-unidade").value.trim().toLowerCase())?.nome;
  if (!nome || !grupoId || !grupoNome) {
    mostrarMsg("#msg-form-item", "Digite o nome do grupo e selecione uma das sugestões.", "erro");
    return;
  }
  if (!unidade) {
    mostrarMsg("#msg-form-item", "Digite a unidade e selecione uma das sugestões.", "erro");
    return;
  }
  const dados = {
    nome, descricao: $("#fi-descricao").value.trim() || null, descricaoUnidade: $("#fi-descricao-unidade").value.trim() || null,
    valor: paraNumero($("#fi-valor").value), marca: $("#fi-marca").value.trim() || null, grupoId, grupoNome, unidade,
  };
  $("#btn-salvar-item").disabled = true;
  try {
    if (id) {
      await updateDoc(doc(bd, "espacos", espacoIdAtual, "itens", id), dados);
    } else {
      await addDoc(collection(bd, "espacos", espacoIdAtual, "itens"), dados);
      notificarMembrosEspaco(`${nomeExibicaoUsuario()} cadastrou o item "${nome}".`);
    }
    exibirSucesso("Item salvo com sucesso!");
    irParaTela("cadastro-itens");
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
  const container = $("#lista-cadastro-grupos");
  if (gruposAtuais.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhum grupo cadastrado.</div>`;
    return;
  }
  container.innerHTML = gruposAtuais
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
  const container = $("#lista-cadastro-locais");
  if (locaisAtuais.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhum local cadastrado.</div>`;
    return;
  }
  container.innerHTML = locaisAtuais
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

async function renderLocaisMaisBaratos() {
  const container = $("#dash-locais-baratos");
  if (!container) return;
  if (itensAtuais.length === 0 || locaisAtuais.length === 0) {
    container.innerHTML = `<div class="dash-vazio">Cadastre itens e locais para comparar preços.</div>`;
    return;
  }
  const somaIndicePorLocal = new Map();
  const contagemPorLocal = new Map();

  for (const item of itensAtuais) {
    const snap = await getDocs(collection(bd, "espacos", espacoIdAtual, "itens", item.id, "historicoPrecos"));
    const registros = ultimosPorLocal(snap.docs.map((d) => d.data()));
    if (registros.length < 2) continue;
    const mediaDoItem = registros.reduce((s, r) => s + r.valor, 0) / registros.length;
    if (mediaDoItem <= 0) continue;
    for (const r of registros) {
      const indice = r.valor / mediaDoItem;
      somaIndicePorLocal.set(r.localId, (somaIndicePorLocal.get(r.localId) || 0) + indice);
      contagemPorLocal.set(r.localId, (contagemPorLocal.get(r.localId) || 0) + 1);
    }
  }

  const ranking = [...contagemPorLocal.entries()]
    .map(([localId, contagem]) => ({
      nome: locaisAtuais.find((l) => l.id === localId)?.nome || "—",
      indiceMedio: somaIndicePorLocal.get(localId) / contagem,
    }))
    .sort((a, b) => a.indiceMedio - b.indiceMedio);

  if (ranking.length === 0) {
    container.innerHTML = `<div class="dash-vazio">Ainda sem dados suficientes — compre o mesmo item em mais de um local para comparar preços.</div>`;
    return;
  }

  container.innerHTML = ranking
    .map((r) => {
      const percentual = Math.round((r.indiceMedio - 1) * 100);
      const cor = percentual < 0 ? "var(--status-verde)" : percentual > 0 ? "var(--status-vermelho)" : "var(--muted)";
      const texto = percentual === 0 ? "na média" : percentual < 0 ? `${Math.abs(percentual)}% mais barato` : `${percentual}% mais caro`;
      return `<div class="item-aplicacao">
        <span class="nome">${esc(r.nome)}</span>
        <span class="percentual" style="color:${cor};width:auto;font-weight:700">${texto}</span>
      </div>`;
    })
    .join("");
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
// o que comparar. É o inverso de renderLocaisMaisBaratos: aqui o agrupamento é por item.
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

  maisBaratosAqui.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  container.innerHTML = maisBaratosAqui.length
    ? maisBaratosAqui.map((i) => `<div class="item-aplicacao"><span class="nome">${esc(i.nome)}</span><span class="valor">${formatarMoeda(i.valor)}</span></div>`).join("")
    : `<div class="dash-vazio">Ainda sem itens em que este local seja o mais barato — precisa comprar o mesmo item em outro local para comparar.</div>`;
}
async function salvarLocal() {
  const id = $("#fl-id").value;
  const nome = $("#fl-nome").value.trim();
  if (!nome) {
    mostrarMsg("#msg-form-local", "Informe o nome do local.", "erro");
    return;
  }
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
  const container = $("#lista-cadastro-formas");
  if (formasAtuais.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhuma forma de pagamento cadastrada.</div>`;
    return;
  }
  container.innerHTML = formasAtuais.map((f) => `<div class="item" data-id="${f.id}"><div class="info"><div class="nome">${esc(f.nome)}</div></div></div>`).join("");
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
  if (listasAtuais.some((l) => l.formaPagamentoId === id)) {
    mostrarMsg("#msg-form-forma", "Esta forma de pagamento está vinculada a uma compra já finalizada — não é possível excluir.", "erro");
    return;
  }
  if (!confirm("Excluir esta forma de pagamento?")) return;
  await deleteDoc(doc(bd, "espacos", espacoIdAtual, "formasPagamento", id));
  irParaTela("cadastro-formas");
}

/* ---------- cadastro: unidades de medida ---------- */
function renderCadastroUnidades() {
  const container = $("#lista-cadastro-unidades");
  if (unidadesAtuais.length === 0) {
    container.innerHTML = `<div class="vazio">Nenhuma unidade de medida cadastrada.</div>`;
    return;
  }
  container.innerHTML = unidadesAtuais.map((u) => `<div class="item" data-id="${u.id}"><div class="info"><div class="nome">${esc(u.nome)}</div></div></div>`).join("");
  container.querySelectorAll(".item").forEach((el) => {
    el.onclick = () => abrirFormEditarUnidade(unidadesAtuais.find((u) => u.id === el.dataset.id));
  });
}
function abrirFormNovaUnidade() {
  telaAnterior = "cadastro-unidades";
  $("#fu-id").value = "";
  $("#fu-nome").value = "";
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
  const dados = { nome, fracionavel: fracionavelUnidadeSelecionado === "sim" };
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
    ? entradas.map((m) => `<div class="linha-membro"><span class="nome">${esc(m.nome || m.email)}</span><span>${esc(m.email)}</span></div>`).join("")
    : `<div class="vazio">Nenhum membro encontrado.</div>`;
}
function renderConvitesPendentes() {
  const pendentes = convitesAtuais.filter((c) => c.status === "pendente");
  const container = $("#lista-convites");
  container.innerHTML = pendentes.length
    ? pendentes.map((c) => `<div class="linha-convite-pendente" data-id="${c.id}">
        <span class="nome">${esc(c.deEmail)}</span>
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
  const total = notificacoesAtuais.length;
  badge.textContent = total > 9 ? "9+" : String(total);
  badge.classList.toggle("hidden", total === 0);

  const container = $("#lista-notificacoes");
  if (total === 0) {
    container.innerHTML = `<div class="notif-vazio">Nenhuma notificação.</div>`;
    return;
  }
  container.innerHTML = notificacoesAtuais
    .map((n) => `<div class="notif-item nao-lida" data-id="${n.id}">
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
      irParaTela("compartilhadas");
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
    mostrarMsg("#msg-compartilhadas", `Convite enviado para ${paraEmail}.`, "ok");
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
  await batch.commit();
  exibirSucesso("Convite aceito! Agora vocês compartilham o mesmo espaço.");
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

function irParaTela(nome) {
  TODAS_AS_TELAS.forEach((t) => $(`#tela-${t}`).classList.toggle("hidden", t !== nome));
  document.querySelectorAll(".menu-item").forEach((item) => item.classList.toggle("ativa", item.dataset.tela === nome));
  $("#topbar-titulo").textContent = TITULOS_TELA_PRINCIPAL[nome] ?? "";
  $("#btn-menu").classList.remove("modo-voltar");
  // O histórico de preços muda com frequência (toda compra confirmada) sem que grupos/locais/
  // itens mudem — por isso este dashboard precisa recalcular também ao simplesmente abrir a tela.
  if (nome === "inicio") renderLocaisMaisBaratos();
}
function mostrarTelaCheia(nome, titulo) {
  TODAS_AS_TELAS.forEach((t) => $(`#tela-${t}`).classList.toggle("hidden", t !== nome));
  $("#topbar-titulo").textContent = titulo;
  $("#btn-menu").classList.add("modo-voltar");
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
    titulo: "Bem-vindo(a) ao Listo!",
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

function ligarEventos() {
  $("#btn-entrar").onclick = entrar;
  $("#login-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });
  $("#btn-esqueci").onclick = esqueciSenha;
  $("#btn-ir-cadastro").onclick = () => { $("#tela-login").classList.add("hidden"); $("#tela-cadastro").classList.remove("hidden"); };
  $("#btn-ir-login").onclick = () => { $("#tela-cadastro").classList.add("hidden"); $("#tela-login").classList.remove("hidden"); };
  $("#btn-criar-conta").onclick = criarConta;

  $("#btn-menu").onclick = () => {
    if ($("#btn-menu").classList.contains("modo-voltar")) {
      // "lista-detalhe" não é uma tela principal (irParaTela não sabe reabri-la com o título e os
      // dados certos) — quando o item foi aberto de dentro de uma lista, volta pra essa lista.
      const lista = telaAnterior === "lista-detalhe" ? listaAbertaAtual() : null;
      if (lista) abrirListaDetalhe(lista);
      else irParaTela(telaAnterior);
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
      if (btn.dataset.tipo === "lista") abrirFormNovaLista();
      else abrirFormNovoItem();
    };
  });
  $("#fab-listas").onclick = abrirFormNovaLista;
  $("#fab-cadastro-itens").onclick = abrirFormNovoItem;
  $("#fab-cadastro-grupos").onclick = abrirFormNovoGrupo;
  $("#fab-cadastro-locais").onclick = abrirFormNovoLocal;
  $("#fab-cadastro-formas").onclick = abrirFormNovaForma;
  $("#fab-cadastro-unidades").onclick = abrirFormNovaUnidade;

  $("#card-lista-proxima").onclick = () => {
    const id = $("#mini-carrossel-proxima").dataset.idSelecionado;
    const lista = id && listasAtuais.find((l) => l.id === id);
    if (lista) abrirListaDetalhe(lista);
    else irParaTela("listas");
  };

  $("#btn-salvar-lista").onclick = salvarLista;
  $("#btn-excluir-lista").onclick = excluirListaAtual;
  $("#btn-cancelar-lista").onclick = () => irParaTela(telaAnterior);

  $("#ld-item-nome").addEventListener("input", (e) => {
    $("#ld-item-id").value = "";
    renderSugestoesItemLista(e.target.value);
  });
  $("#ld-item-nome").addEventListener("blur", () => setTimeout(() => $("#ld-item-sugestoes").classList.add("hidden"), 150));
  $("#btn-adicionar-item-lista").onclick = adicionarItemNaLista;
  $("#btn-abrir-form-add-item").onclick = () => {
    $("#btn-abrir-form-add-item").classList.add("hidden");
    $("#form-adicionar-item").classList.remove("hidden");
    $("#ld-item-nome").focus();
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
  $("#btn-finalizar-compra").onclick = abrirModalFinalizar;
  $("#btn-compartilhar-lista").onclick = compartilharListaWhatsApp;

  $("#btn-confirmar-compra").onclick = confirmarCompra;
  $("#btn-cancelar-compra").onclick = fecharModalComprar;
  $("#overlay-comprar").addEventListener("click", (e) => { if (e.target.id === "overlay-comprar") fecharModalComprar(); });

  $("#btn-confirmar-quantidade").onclick = confirmarQuantidade;
  $("#btn-cancelar-quantidade").onclick = fecharModalQuantidade;
  $("#overlay-quantidade").addEventListener("click", (e) => { if (e.target.id === "overlay-quantidade") fecharModalQuantidade(); });

  $("#btn-confirmar-finalizar").onclick = confirmarFinalizar;
  $("#btn-cancelar-finalizar").onclick = fecharModalFinalizar;
  $("#overlay-finalizar").addEventListener("click", (e) => { if (e.target.id === "overlay-finalizar") fecharModalFinalizar(); });
  $("#fin-forma").addEventListener("change", () => {
    const forma = formasAtuais.find((f) => f.id === $("#fin-forma").value);
    $("#fin-parcelas-wrap").classList.toggle("hidden", forma?.nome !== "Cartão de Crédito");
  });

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
  $("#btn-excluir-item").onclick = excluirItemAtual;
  $("#btn-cancelar-item").onclick = () => irParaTela(telaAnterior);

  $("#btn-salvar-grupo").onclick = salvarGrupo;
  $("#btn-excluir-grupo").onclick = excluirGrupoAtual;
  $("#btn-cancelar-grupo").onclick = () => irParaTela(telaAnterior);

  $("#btn-salvar-local").onclick = salvarLocal;
  $("#btn-abrir-site-local").onclick = () => {
    const site = $("#fl-site").value.trim();
    if (site) window.open(site, "_blank", "noopener");
  };
  $("#btn-excluir-local").onclick = excluirLocalAtual;
  $("#btn-cancelar-local").onclick = () => irParaTela(telaAnterior);

  $("#btn-salvar-forma").onclick = salvarForma;
  $("#btn-excluir-forma").onclick = excluirFormaAtual;
  $("#btn-cancelar-forma").onclick = () => irParaTela(telaAnterior);

  $("#btn-salvar-unidade").onclick = salvarUnidade;
  $("#btn-excluir-unidade").onclick = excluirUnidadeAtual;
  $("#btn-cancelar-unidade").onclick = () => irParaTela(telaAnterior);

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

  ["#mc-valor", "#fi-valor"].forEach(ligarMascaraMoeda);
  ["#ld-quantidade", "#fin-parcelas"].forEach(bloquearCaracteresInvalidosNumero);
  ["#ld-quantidade", "#qtd-valor", "#env-quantidade"].forEach(bloquearDecimalSeNaoFracionavel);
  renderOpcoesValorProvisionado();

  $("#btn-onboarding-proximo").onclick = () => {
    if (onboardingPassoAtual === ONBOARDING_PASSOS.length - 1) concluirOnboarding();
    else { onboardingPassoAtual++; renderOnboarding(); }
  };
  $("#btn-onboarding-voltar").onclick = () => { onboardingPassoAtual = Math.max(0, onboardingPassoAtual - 1); renderOnboarding(); };
  $("#btn-onboarding-pular").onclick = concluirOnboarding;
}
