"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { mensagemErroAuth } from "@/lib/authErrors";
import { CLASSE_BOTAO_PRIMARIO, CLASSE_INPUT } from "@/lib/estilos";

export default function CadastroPage() {
  const { usuario, cadastrar } = useAuth();
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (usuario) router.replace("/listas");
  }, [usuario, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      await cadastrar(nome, email, senha);
      router.replace("/listas");
    } catch (err) {
      setErro(mensagemErroAuth(err));
      setEnviando(false);
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
          <h2 className="mb-6 text-center text-xl font-semibold text-slate-900 dark:text-slate-100">Criar conta</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="nome">
                Nome
              </label>
              <input
                id="nome"
                type="text"
                required
                autoComplete="name"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className={CLASSE_INPUT}
              />
            </div>
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
                minLength={6}
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className={CLASSE_INPUT}
              />
            </div>

            {erro && <p className="text-sm text-red-600">{erro}</p>}

            <button type="submit" disabled={enviando} className={CLASSE_BOTAO_PRIMARIO}>
              {enviando ? "Criando conta..." : "Criar conta"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Já tem conta?{" "}
            <Link href="/login" className="font-medium text-indigo-600 underline dark:text-indigo-400">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
