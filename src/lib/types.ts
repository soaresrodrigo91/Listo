export type Usuario = {
  nome: string;
  email: string;
  criadoEm: string;
};

export type MembroInfo = {
  nome: string;
  email: string;
};

export type Lista = {
  id: string;
  nome: string;
  criadoPor: string;
  criadoEm: string;
  membros: string[];
  membrosInfo: Record<string, MembroInfo>;
};

export type Item = {
  id: string;
  nome: string;
  quantidade: number;
  unidade: string | null;
  categoria: string | null;
  comprado: boolean;
  compradoPor: string | null;
  compradoEm: string | null;
  criadoPor: string;
  criadoEm: string;
};

export type StatusConvite = "pendente" | "aceito" | "recusado";

export type Convite = {
  id: string;
  listaId: string;
  listaNome: string;
  deUid: string;
  deEmail: string;
  paraEmail: string;
  paraUid: string | null;
  status: StatusConvite;
  criadoEm: string;
};
