/**
 * Zachowany dla zgodności importów – dane i logowanie obsługuje teraz własny serwer
 * (patrz lib/docstore.ts oraz context/AuthContext.tsx).
 */
export { db } from './docstore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}
