export function mensagemErroAuth(erro: unknown): string {
  const codigo = (erro as { code?: string })?.code ?? "";
  const mapa: Record<string, string> = {
    "auth/email-already-in-use": "Já existe uma conta com este e-mail.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente novamente.",
  };
  return mapa[codigo] ?? "Ocorreu um erro. Tente novamente.";
}
