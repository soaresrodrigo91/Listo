import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Item } from "./types";

export function assinarItens(listaId: string, callback: (itens: Item[]) => void) {
  return onSnapshot(collection(db, "listas", listaId, "itens"), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Item));
  });
}

// Não comprados primeiro (por categoria, depois nome); comprados no fim, mais recente primeiro.
export function ordenarItens(itens: Item[]): Item[] {
  return [...itens].sort((a, b) => {
    if (a.comprado !== b.comprado) return a.comprado ? 1 : -1;
    if (a.comprado && b.comprado) {
      return (b.compradoEm ?? "").localeCompare(a.compradoEm ?? "");
    }
    const categoriaA = a.categoria ?? "";
    const categoriaB = b.categoria ?? "";
    if (categoriaA !== categoriaB) return categoriaA.localeCompare(categoriaB);
    return a.nome.localeCompare(b.nome);
  });
}

export async function adicionarItem(
  listaId: string,
  uid: string,
  dados: { nome: string; quantidade: number; unidade: string | null; categoria: string | null }
) {
  await addDoc(collection(db, "listas", listaId, "itens"), {
    ...dados,
    comprado: false,
    compradoPor: null,
    compradoEm: null,
    criadoPor: uid,
    criadoEm: serverTimestamp(),
  });
}

export async function alternarComprado(listaId: string, item: Item, uid: string) {
  const marcarComoComprado = !item.comprado;
  await updateDoc(doc(db, "listas", listaId, "itens", item.id), {
    comprado: marcarComoComprado,
    compradoPor: marcarComoComprado ? uid : null,
    compradoEm: marcarComoComprado ? serverTimestamp() : null,
  });
}

export async function removerItem(listaId: string, itemId: string) {
  await deleteDoc(doc(db, "listas", listaId, "itens", itemId));
}
