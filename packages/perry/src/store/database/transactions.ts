// database/transactions — nestable write transactions.
//
// Only the outermost call opens and commits; nested calls join it, and any
// throw rolls the whole unit back. BEGIN IMMEDIATE takes the write lock up
// front so concurrent writers fail fast instead of deadlocking mid-transaction.
import { withDb } from "./connection";

let transactionDepth = 0;

export function withBrainTransaction<T>(callback: () => T): T {
  return withDb((db) => {
    const outermost = transactionDepth === 0;
    if (outermost) db.exec("BEGIN IMMEDIATE;");
    transactionDepth += 1;
    try {
      const result = callback();
      transactionDepth -= 1;
      if (outermost) db.exec("COMMIT;");
      return result;
    } catch (error) {
      transactionDepth -= 1;
      if (outermost) db.exec("ROLLBACK;");
      throw error;
    }
  });
}
