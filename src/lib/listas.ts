import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  arrayRemove,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Lista } from "./types";

export function assinarListas(uid: string, callback: (listas: Lista[]) => void) {
  const q = query(collection(db, "listas"), where("membros", "array-contains", uid));
  return onSnapshot(q, (snap) => {
    const listas = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as Lista)
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
    callback(listas);
  });
}

export function assinarLista(listaId: string, callback: (lista: Lista | null) => void) {
  return onSnapshot(doc(db, "listas", listaId), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Lista) : null);
  });
}

export async function criarLista(uid: string, nome: string, nomeUsuario: string, email: string) {
  const ref = await addDoc(collection(db, "listas"), {
    nome,
    criadoPor: uid,
    criadoEm: serverTimestamp(),
    membros: [uid],
    membrosInfo: { [uid]: { nome: nomeUsuario, email } },
  });
  return ref.id;
}

export async function renomearLista(listaId: string, nome: string) {
  await updateDoc(doc(db, "listas", listaId), { nome });
}

export async function sairDaLista(listaId: string, uid: string) {
  await updateDoc(doc(db, "listas", listaId), {
    membros: arrayRemove(uid),
    [`membrosInfo.${uid}`]: deleteField(),
  });
}

export async function excluirLista(listaId: string) {
  const itensSnap = await getDocs(collection(db, "listas", listaId, "itens"));
  await Promise.all(itensSnap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "listas", listaId));
}
