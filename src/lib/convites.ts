import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { buscarUsuarioPorEmail, normalizarEmail } from "./usuarios";
import type { Convite, Lista } from "./types";

function idConvite(listaId: string, emailNormalizado: string) {
  return `${listaId}_${emailNormalizado}`;
}

export async function convidarParaLista(
  lista: Lista,
  deUid: string,
  deEmail: string,
  paraEmailBruto: string
) {
  const paraEmail = normalizarEmail(paraEmailBruto);
  if (paraEmail === normalizarEmail(deEmail)) {
    throw new Error("Você já faz parte desta lista.");
  }
  const usuarioExistente = await buscarUsuarioPorEmail(paraEmail);
  if (usuarioExistente && lista.membros.includes(usuarioExistente.uid)) {
    throw new Error("Esta pessoa já é membro da lista.");
  }

  await setDoc(doc(db, "convites", idConvite(lista.id, paraEmail)), {
    listaId: lista.id,
    listaNome: lista.nome,
    deUid,
    deEmail: normalizarEmail(deEmail),
    paraEmail,
    paraUid: usuarioExistente?.uid ?? null,
    status: "pendente",
    criadoEm: serverTimestamp(),
  });
}

// Convites pendentes/recentes recebidos por uid (conta já existia no convite) ou por e-mail
// (convite criado antes de a pessoa se cadastrar). Duas assinaturas porque o Firestore não
// combina campos diferentes numa única query "ou" com onSnapshot de forma simples.
export function assinarConvitesRecebidos(
  uid: string,
  email: string,
  callback: (convites: Convite[]) => void
) {
  const porUid = new Map<string, Convite>();
  const porEmail = new Map<string, Convite>();

  function emitir() {
    const combinados = new Map([...porEmail, ...porUid]);
    callback(
      [...combinados.values()].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    );
  }

  const unsubUid = onSnapshot(
    query(collection(db, "convites"), where("paraUid", "==", uid)),
    (snap) => {
      porUid.clear();
      snap.docs.forEach((d) => porUid.set(d.id, { id: d.id, ...d.data() } as Convite));
      emitir();
    }
  );

  const unsubEmail = onSnapshot(
    query(collection(db, "convites"), where("paraEmail", "==", normalizarEmail(email))),
    (snap) => {
      porEmail.clear();
      snap.docs.forEach((d) => porEmail.set(d.id, { id: d.id, ...d.data() } as Convite));
      emitir();
    }
  );

  return () => {
    unsubUid();
    unsubEmail();
  };
}

export async function aceitarConvite(convite: Convite, uid: string, nome: string, email: string) {
  const listaSnap = await getDoc(doc(db, "listas", convite.listaId));
  if (!listaSnap.exists()) throw new Error("Esta lista não existe mais.");

  const batch = writeBatch(db);
  batch.update(doc(db, "convites", convite.id), { status: "aceito", paraUid: uid });
  batch.update(doc(db, "listas", convite.listaId), {
    membros: arrayUnion(uid),
    [`membrosInfo.${uid}`]: { nome, email: normalizarEmail(email) },
  });
  await batch.commit();
}

export async function recusarConvite(convite: Convite) {
  await updateDoc(doc(db, "convites", convite.id), { status: "recusado" });
}
