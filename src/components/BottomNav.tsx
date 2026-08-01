"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITENS = [
  { href: "/listas", rotulo: "Listas", icone: "🛒" },
  { href: "/configuracoes", rotulo: "Config.", icone: "⚙️" },
];

export default function BottomNav({ badgeConfiguracoes = 0 }: { badgeConfiguracoes?: number }) {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-20 flex shrink-0 border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {ITENS.map((item) => {
        const ativo = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badge = item.href === "/configuracoes" ? badgeConfiguracoes : 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium ${
              ativo ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            <span className="text-lg leading-none">{item.icone}</span>
            {item.rotulo}
            {badge > 0 && (
              <span className="absolute right-1/2 top-1 translate-x-4 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
