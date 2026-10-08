/**
 * Valores de stores.syncedAt que no son un timestamp ISO.
 * null = edición del usuario pendiente de push.
 * Un timestamp = ya coincide con Firestore.
 */
export const STORE_SYNC_BOOTSTRAP = 'bootstrap'
export const STORE_SYNC_UNARCHIVE = 'unarchive'
