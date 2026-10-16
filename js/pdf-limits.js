// Limite por PDF. Os blocos de upload continuam limitados a 8 MiB.
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
// Documentos antigos continuam legíveis; o limite acima só vale para envios.
export const MAX_PDF_READ_BYTES = 200 * 1024 * 1024;
