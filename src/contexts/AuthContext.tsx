"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { garantirUsuarioSemeado } from "@/lib/usuarios";

type AuthContextValue = {
  usuario: User | null;
  carregando: boolean;
  cadastrar: (nome: string, email: string, senha: string) => Promise<void>;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  redefinirSenha: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        await garantirUsuarioSemeado(user.uid, user.displayName ?? "", user.email ?? "");
      }
      setUsuario(user);
      setCarregando(false);
    });
  }, []);

  async function cadastrar(nome: string, email: string, senha: string) {
    const credencial = await createUserWithEmailAndPassword(auth, email, senha);
    await updateProfile(credencial.user, { displayName: nome });
    await garantirUsuarioSemeado(credencial.user.uid, nome, email);
    setUsuario(credencial.user);
  }

  async function entrar(email: string, senha: string) {
    await signInWithEmailAndPassword(auth, email, senha);
  }

  async function sair() {
    await signOut(auth);
  }

  async function redefinirSenha(email: string) {
    await sendPasswordResetEmail(auth, email);
  }

  return (
    <AuthContext.Provider value={{ usuario, carregando, cadastrar, entrar, sair, redefinirSenha }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
