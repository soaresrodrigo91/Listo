"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { mensagemErroAuth } from "@/lib/authErrors";
import { CLASSE_BOTAO_PRIMARIO, CLASSE_INPUT } from "@/lib/estilos";

export default function LoginPage() {
  const { usuario, entrar, redefinirSenha } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (usuario) router.replace("/listas");
  }, [usuario, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    setEnviando(true);
    try {
      await entrar(email, senha);
    } catch (err) {
      setErro(mensagemErroAuth(err));
      setEnviando(false);
    }
  }

  async function handleEsqueciSenha() {
    setErro("");
    setAviso("");
    if (!email) {
      setErro('Digite seu e-mail acima e clique em "Esqueci minha senha" novamente.');
      return;
    }
    try {
      await redefinirSenha(email);
      setAviso("Enviamos um e-mail com instruções para redefinir sua senha.");
    } catch (err) {
      setErro(mensagemErroAuth(err));
    }
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-slate-50 px-4 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-2xl font-bold text-slate-900 dark:text-slate-100">🛒 Lista de Compras</h1>
        <p className="mb-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Listas compartilhadas em tempo real
        </p>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h2 className="mb-6 text-center text-xl font-semibold text-slate-900 dark:text-slate-100">Entrar</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={CLASSE_INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="senha">
                Senha
              </label>
              <input
                id="senha"
                type="password"
                required
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className={CLASSE_INPUT}
              />
            </div>

            {erro && <p className="text-sm text-red-600">{erro}</p>}
            {aviso && <p className="text-sm text-green-600">{aviso}</p>}

            <button type="submit" disabled={enviando} className={CLASSE_BOTAO_PRIMARIO}>
              {enviando ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <button
            onClick={handleEsqueciSenha}
            className="mt-3 block w-full text-center text-sm text-slate-500 underline dark:text-slate-400"
          >
            Esqueci minha senha
          </button>

          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Não tem conta?{" "}
            <Link href="/cadastro" className="font-medium text-indigo-600 underline dark:text-indigo-400">
              Cadastre-se
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
