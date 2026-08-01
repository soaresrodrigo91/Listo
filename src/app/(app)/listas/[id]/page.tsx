"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { assinarLista, excluirLista, renomearLista, sairDaLista } from "@/lib/listas";
import { adicionarItem, alternarComprado, assinarItens, ordenarItens, removerItem } from "@/lib/itens";
import { convidarParaLista } from "@/lib/convites";
import type { Item, Lista } from "@/lib/types";
import Modal from "@/components/Modal";
import { CLASSE_BOTAO_PRIMARIO, CLASSE_BOTAO_SECUNDARIO, CLASSE_INPUT } from "@/lib/estilos";

export default function ListaDetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { usuario } = useAuth();
  const router = useRouter();

  const [lista, setLista] = useState<Lista | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [nomeItem, setNomeItem] = useState("");
  const [quantidadeItem, setQuantidadeItem] = useState("1");
  const [unidadeItem, setUnidadeItem] = useState("");
  const [categoriaItem, setCategoriaItem] = useState("");

  const [modalConvite, setModalConvite] = useState(false);
  const [emailConvite, setEmailConvite] = useState("");
  const [enviandoConvite, setEnviandoConvite] = useState(false);
  const [erroConvite, setErroConvite] = useState("");
  const [avisoConvite, setAvisoConvite] = useState("");

  const [modalOpcoes, setModalOpcoes] = useState(false);
  const [novoNomeLista, setNovoNomeLista] = useState("");

  useEffect(() => {
    const unsubLista = assinarLista(id, (dados) => {
      setLista(dados);
      setCarregando(false);
    });
    const unsubItens = assinarItens(id, setItens);
    return () => {
      unsubLista();
      unsubItens();
    };
  }, [id]);

  async function handleAdicionarItem(e: FormEvent) {
    e.preventDefault();
    if (!usuario || !nomeItem.trim()) return;
    await adicionarItem(id, usuario.uid, {
      nome: nomeItem.trim(),
      quantidade: Number(quantidadeItem) || 1,
      unidade: unidadeItem.trim() || null,
      categoria: categoriaItem.trim() || null,
    });
    setNomeItem("");
    setQuantidadeItem("1");
    setUnidadeItem("");
    setCategoriaItem("");
  }

  async function handleConvidar(e: FormEvent) {
    e.preventDefault();
    if (!lista || !usuario?.email) return;
    setErroConvite("");
    setAvisoConvite("");
    setEnviandoConvite(true);
    try {
      await convidarParaLista(lista, usuario.uid, usuario.email, emailConvite);
      setAvisoConvite(`Convite enviado para ${emailConvite}.`);
      setEmailConvite("");
    } catch (err) {
      setErroConvite(err instanceof Error ? err.message : "Não foi possível enviar o convite.");
    } finally {
      setEnviandoConvite(false);
    }
  }

  async function handleRenomear(e: FormEvent) {
    e.preventDefault();
    if (!novoNomeLista.trim()) return;
    await renomearLista(id, novoNomeLista.trim());
    setModalOpcoes(false);
  }

  async function handleSair() {
    if (!usuario) return;
    if (!confirm("Sair desta lista? Você deixará de ver as atualizações dela.")) return;
    await sairDaLista(id, usuario.uid);
    router.replace("/listas");
  }

  async function handleExcluir() {
    if (!confirm("Excluir esta lista para todos os membros? Esta ação não pode ser desfeita.")) return;
    await excluirLista(id);
    router.replace("/listas");
  }

  if (carregando) {
    return <p className="p-6 text-sm text-slate-500 dark:text-slate-400">Carregando...</p>;
  }

  if (!lista) {
    return (
      <div className="p-6 text-center">
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Esta lista não existe mais.</p>
        <Link href="/listas" className="text-indigo-600 underline dark:text-indigo-400">
          Voltar para minhas listas
        </Link>
      </div>
    );
  }

  const souCriador = usuario?.uid === lista.criadoPor;
  const itensOrdenados = ordenarItens(itens);
  const pendentes = itensOrdenados.filter((i) => !i.comprado);
  const comprados = itensOrdenados.filter((i) => i.comprado);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Link href="/listas" className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          ← Listas
        </Link>
        <button
          onClick={() => {
            setNovoNomeLista(lista.nome);
            setModalOpcoes(true);
          }}
          className="text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          Opções
        </button>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{lista.nome}</h1>
        <button onClick={() => setModalConvite(true)} className={CLASSE_BOTAO_SECUNDARIO + " w-auto px-3 py-1.5 text-sm"}>
          + Convidar
        </button>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {Object.entries(lista.membrosInfo ?? {}).map(([uid, info]) => (
          <span
            key={uid}
            className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            {info.nome || info.email}
          </span>
        ))}
      </div>

      <form onSubmit={handleAdicionarItem} className="mb-6 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <input
          type="text"
          required
          placeholder="Adicionar item (ex.: Arroz)"
          value={nomeItem}
          onChange={(e) => setNomeItem(e.target.value)}
          className={CLASSE_INPUT}
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            placeholder="Qtd."
            value={quantidadeItem}
            onChange={(e) => setQuantidadeItem(e.target.value)}
            className={CLASSE_INPUT + " w-20"}
          />
          <input
            type="text"
            placeholder="Unidade (kg, un...)"
            value={unidadeItem}
            onChange={(e) => setUnidadeItem(e.target.value)}
            className={CLASSE_INPUT}
          />
          <input
            type="text"
            placeholder="Categoria"
            value={categoriaItem}
            onChange={(e) => setCategoriaItem(e.target.value)}
            className={CLASSE_INPUT}
          />
        </div>
        <button type="submit" className={CLASSE_BOTAO_PRIMARIO}>
          Adicionar
        </button>
      </form>

      {itensOrdenados.length === 0 && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400">Nenhum item ainda. Adicione o primeiro acima.</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {pendentes.map((item) => (
          <ItemLinha key={item.id} item={item} listaId={id} uid={usuario!.uid} />
        ))}
      </ul>

      {comprados.length > 0 && (
        <>
          <p className="mb-1 mt-6 text-xs font-medium uppercase text-slate-400">Comprados</p>
          <ul className="flex flex-col gap-1.5 opacity-60">
            {comprados.map((item) => (
              <ItemLinha key={item.id} item={item} listaId={id} uid={usuario!.uid} />
            ))}
          </ul>
        </>
      )}

      <Modal aberto={modalConvite} onFechar={() => setModalConvite(false)} titulo="Convidar para a lista">
        <form onSubmit={handleConvidar} className="flex flex-col gap-4">
          <input
            type="email"
            required
            placeholder="e-mail@exemplo.com"
            value={emailConvite}
            onChange={(e) => setEmailConvite(e.target.value)}
            className={CLASSE_INPUT}
          />
          {erroConvite && <p className="text-sm text-red-600">{erroConvite}</p>}
          {avisoConvite && <p className="text-sm text-green-600">{avisoConvite}</p>}
          <button type="submit" disabled={enviandoConvite} className={CLASSE_BOTAO_PRIMARIO}>
            {enviandoConvite ? "Enviando..." : "Enviar convite"}
          </button>
        </form>
      </Modal>

      <Modal aberto={modalOpcoes} onFechar={() => setModalOpcoes(false)} titulo="Opções da lista">
        <div className="flex flex-col gap-4">
          <form onSubmit={handleRenomear} className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Renomear lista</label>
            <input
              type="text"
              required
              value={novoNomeLista}
              onChange={(e) => setNovoNomeLista(e.target.value)}
              className={CLASSE_INPUT}
            />
            <button type="submit" className={CLASSE_BOTAO_SECUNDARIO}>
              Salvar nome
            </button>
          </form>

          <button onClick={handleSair} className={CLASSE_BOTAO_SECUNDARIO}>
            Sair desta lista
          </button>

          {souCriador && (
            <button
              onClick={handleExcluir}
              className="w-full rounded-lg border border-red-300 px-4 py-2 font-medium text-red-600 transition hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
            >
              Excluir lista para todos
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}

function ItemLinha({ item, listaId, uid }: { item: Item; listaId: string; uid: string }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
      <input
        type="checkbox"
        checked={item.comprado}
        onChange={() => alternarComprado(listaId, item, uid)}
        className="h-5 w-5 rounded accent-indigo-600"
      />
      <div className={`flex-1 ${item.comprado ? "line-through" : ""}`}>
        <span className="text-slate-900 dark:text-slate-100">{item.nome}</span>
        <span className="ml-2 text-xs text-slate-400">
          {item.quantidade}
          {item.unidade ? ` ${item.unidade}` : ""}
          {item.categoria ? ` · ${item.categoria}` : ""}
        </span>
      </div>
      <button
        onClick={() => removerItem(listaId, item.id)}
        aria-label="Remover item"
        className="text-slate-300 hover:text-red-500"
      >
        ×
      </button>
    </li>
  );
}
