/**
 * Logs de la balanza, apagados.
 * El sondeo de COM, el enlace y cada PLU llenaban el archivo.
 * Para volver a verlos: descomentar el import y borrar el stub.
 */
// import log from 'electron-log'
const log = {
  info(_message?: unknown, ..._rest: unknown[]): void {},
  warn(_message?: unknown, ..._rest: unknown[]): void {},
  error(_message?: unknown, ..._rest: unknown[]): void {},
  debug(_message?: unknown, ..._rest: unknown[]): void {},
}

export default log
