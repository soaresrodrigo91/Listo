"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { assinarListas, criarLista } from "@/lib/listas";
import type { Lista } from "@/lib/types";
import Modal from "@/components/Modal";
import { CLASSE_BOTAO_PRIMARIO, CLASSE_INPUT } from "@/lib/estilos";

export default function ListasPage() {
  const { usuario } = useAuth();
  const [listas, setListas] = useState<Lista[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [nomeLista, setNomeLista] = useState("");
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    if (!usuario) return;
    return assinarListas(usuario.uid, (dados) => {
      setListas(dados);
      setCarregando(false);
    });
  }, [usuario]);

  async function handleCriar(e: FormEvent) {
    e.preventDefault();
    if (!usuario || !nomeLista.trim()) return;
    setCriando(true);
    try {
      await criarLista(usuario.uid, nomeLista.trim(), usuario.displayName ?? "", usuario.email ?? "");
      setNomeLista("");
      setModalAberto(false);
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Minhas listas</h1>
        <button onClick={() => setModalAberto(true)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
          + Nova lista
        </button>
      </div>

      {carregando && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>}

      {!carregando && listas.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
          Você ainda não tem nenhuma lista. Crie a primeira para começar.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {listas.map((lista) => (
          <Link
            key={lista.id}
            href={`/listas/${lista.id}`}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-900 dark:text-slate-100">{lista.nome}</span>
              <span className="text-xs text-slate-400">
                {Object.keys(lista.membrosInfo ?? {}).length}{" "}
                {Object.keys(lista.membrosInfo ?? {}).length === 1 ? "membro" : "membros"}
              </span>
            </div>
          </Link>
        ))}
      </div>

      <Modal aberto={modalAberto} onFechar={() => setModalAberto(false)} titulo="Nova lista">
        <form onSubmit={handleCriar} className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="nomeLista">
              Nome da lista
            </label>
            <input
              id="nomeLista"
              type="text"
              required
              autoFocus
              placeholder="Ex.: Compras do mês"
              value={nomeLista}
              onChange={(e) => setNomeLista(e.target.value)}
              className={CLASSE_INPUT}
            />
          </div>
          <button type="submit" disabled={criando} className={CLASSE_BOTAO_PRIMARIO}>
            {criando ? "Criando..." : "Criar lista"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
