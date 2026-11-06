import { HttpErrorResponse } from '@angular/common/http';
export function failureMessage(error: unknown, operation: string): string {
  if (!(error instanceof HttpErrorResponse))
    return 'Não foi possível confirmar a operação. Verifique sua conexão antes de tentar novamente.';
  switch (error.status) {
    case 400:
      return 'Confira os campos e os requisitos da senha.';
    case 401:
      return operation === 'reset'
        ? 'Link inválido ou indisponível. Solicite uma nova recuperação.'
        : 'Não foi possível entrar com os dados informados.';
    case 403:
    case 415:
      return 'A solicitação foi recusada. Reabra a aplicação pela origem configurada.';
    case 429:
      return 'Muitas tentativas. Aguarde antes de tentar novamente.';
    default:
      return 'Não foi possível confirmar a operação. O resultado pode estar pendente. Não repita automaticamente.';
  }
}
export function retrySeconds(error: unknown): number {
  if (!(error instanceof HttpErrorResponse) || error.status !== 429) return 0;
  const value = error.headers.get('Retry-After');
  if (!value || !/^[1-9][0-9]*$/.test(value)) return 0;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : 0;
}
export function validPassword(value: string): boolean {
  const points = [...value];
  return (
    points.length >= 12 &&
    points.length <= 128 &&
    points.every((point) => {
      const code = point.codePointAt(0)!;
      return code < 0xd800 || code > 0xdfff;
    })
  );
}
