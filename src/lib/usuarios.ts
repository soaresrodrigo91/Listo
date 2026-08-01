import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Chamado no primeiro login (ver AuthContext): grava usuarios/{uid} e o índice
// indiceEmails/{email} -> uid usado para localizar alguém pelo e-mail ao convidar.
// setDoc com merge não sobrescreve o nome em logins seguintes.
export async function garantirUsuarioSemeado(uid: string, nome: string, email: string) {
  const emailNormalizado = normalizarEmail(email);
  const refUsuario = doc(db, "usuarios", uid);
  const snap = await getDoc(refUsuario);

  if (!snap.exists()) {
    await setDoc(refUsuario, {
      nome,
      email: emailNormalizado,
      criadoEm: serverTimestamp(),
    });
  }

  await setDoc(doc(db, "indiceEmails", emailNormalizado), { uid });
}

export async function buscarUsuarioPorEmail(
  email: string
): Promise<{ uid: string } | null> {
  const snap = await getDoc(doc(db, "indiceEmails", normalizarEmail(email)));
  if (!snap.exists()) return null;
  return { uid: snap.data().uid as string };
}
