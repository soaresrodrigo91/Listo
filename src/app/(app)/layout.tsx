"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { assinarConvitesRecebidos } from "@/lib/convites";
import BottomNav from "@/components/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { usuario, carregando, sair } = useAuth();
  const router = useRouter();
  const [convitesPendentes, setConvitesPendentes] = useState(0);

  useEffect(() => {
    if (carregando) return;
    if (!usuario) router.replace("/login");
  }, [usuario, carregando, router]);

  useEffect(() => {
    if (!usuario?.email) return;
    return assinarConvitesRecebidos(usuario.uid, usuario.email, (convites) => {
      setConvitesPendentes(convites.filter((c) => c.status === "pendente").length);
    });
  }, [usuario]);

  if (carregando || !usuario) {
    return (
      <div className="flex min-h-screen flex-1 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Carregando...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
        <span className="font-semibold text-slate-900 dark:text-slate-100">🛒 Lista de Compras</span>
        <button onClick={() => sair()} className="text-sm text-slate-500 underline dark:text-slate-400">
          Sair
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      <BottomNav badgeConfiguracoes={convitesPendentes} />
    </div>
  );
}
