import { parentPort, workerData } from "node:worker_threads";
import { createDatabase } from "../scripts/sqlite-adapter.mjs";
import { Store } from "../src/store.mjs";
const db = createDatabase(workerData.filename),
  store = new Store(db, () => workerData.now);
parentPort.postMessage("ready");
parentPort.once("message", async () => {
  try {
    const result = await store.withLock(
      "candidate:" + workerData.input.candidateId,
      (lock) => store.mutateBooking(workerData.input, lock),
    );
    parentPort.postMessage({ ok: true, id: result.id });
  } catch (e) {
    parentPort.postMessage({ ok: false, code: e.code || e.message });
  } finally {
    db.close();
  }
});
