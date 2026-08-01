"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { aceitarConvite, assinarConvitesRecebidos, recusarConvite } from "@/lib/convites";
import type { Convite } from "@/lib/types";
import { CLASSE_BOTAO_PRIMARIO, CLASSE_BOTAO_SECUNDARIO } from "@/lib/estilos";

export default function ConfiguracoesPage() {
  const { usuario, sair } = useAuth();
  const router = useRouter();
  const [convites, setConvites] = useState<Convite[]>([]);
  const [processando, setProcessando] = useState<string | null>(null);

  useEffect(() => {
    if (!usuario?.email) return;
    return assinarConvitesRecebidos(usuario.uid, usuario.email, setConvites);
  }, [usuario]);

  const pendentes = convites.filter((c) => c.status === "pendente");

  async function handleAceitar(convite: Convite) {
    if (!usuario) return;
    setProcessando(convite.id);
    try {
      await aceitarConvite(convite, usuario.uid, usuario.displayName ?? "", usuario.email ?? "");
      router.push(`/listas/${convite.listaId}`);
    } finally {
      setProcessando(null);
    }
  }

  async function handleRecusar(convite: Convite) {
    setProcessando(convite.id);
    try {
      await recusarConvite(convite);
    } finally {
      setProcessando(null);
    }
  }

  async function handleSair() {
    await sair();
    router.replace("/login");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold text-slate-900 dark:text-slate-100">Configurações</h1>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <p className="text-sm text-slate-500 dark:text-slate-400">Conta</p>
        <p className="font-medium text-slate-900 dark:text-slate-100">{usuario?.displayName || "—"}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400">{usuario?.email}</p>
      </div>

      <h2 className="mb-2 text-sm font-medium uppercase text-slate-400">Convites pendentes</h2>
      {pendentes.length === 0 ? (
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Nenhum convite pendente.</p>
      ) : (
        <ul className="mb-6 flex flex-col gap-2">
          {pendentes.map((convite) => (
            <li key={convite.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
              <p className="mb-3 text-sm text-slate-700 dark:text-slate-300">
                <span className="font-medium">{convite.deEmail}</span> te convidou para a lista{" "}
                <span className="font-medium">{convite.listaNome}</span>.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAceitar(convite)}
                  disabled={processando === convite.id}
                  className={CLASSE_BOTAO_PRIMARIO + " w-auto px-3 py-1.5 text-sm"}
                >
                  Aceitar
                </button>
                <button
                  onClick={() => handleRecusar(convite)}
                  disabled={processando === convite.id}
                  className={CLASSE_BOTAO_SECUNDARIO + " w-auto px-3 py-1.5 text-sm"}
                >
                  Recusar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button onClick={handleSair} className={CLASSE_BOTAO_SECUNDARIO}>
        Sair da conta
      </button>
    </div>
  );
}
