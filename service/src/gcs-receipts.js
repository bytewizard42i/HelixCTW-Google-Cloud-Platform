// SPDX-License-Identifier: Apache-2.0
// GCS audit-receipt writer — the GCP counterpart of the Cloudflare edition's
// R2 DOCUMENT_CACHE binding and the AWS edition's S3 receipt store.
//
// On Cloud Run the Storage client authenticates via Application Default
// Credentials from the service's own service account — no key file, no secret.

import { Storage } from "@google-cloud/storage";

const RECEIPT_KEY_PATTERN = /^compliance\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.json$/;

export function createReceiptStore({ bucketName }) {
  if (typeof bucketName !== "string" || bucketName.length === 0) {
    // No bucket configured: behave like the Worker without DOCUMENT_CACHE —
    // checks still run, receipts are just not persisted, and the response
    // says so honestly via auditStored=false.
    return Object.freeze({
      enabled: false,
      async put() {
        return false;
      },
    });
  }

  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  return Object.freeze({
    enabled: true,
    /**
     * Persist one audit receipt. The object key mirrors the R2 layout:
     * compliance/<YYYY-MM-DD>/<auditId>.json
     */
    async put(receipt) {
      const objectKey = `compliance/${receipt.checkedAt.slice(0, 10)}/${receipt.id}.json`;
      if (!RECEIPT_KEY_PATTERN.test(objectKey)) {
        throw new Error("Refusing to write a receipt with a non-canonical key.");
      }

      await bucket.file(objectKey).save(JSON.stringify(receipt), {
        contentType: "application/json",
        resumable: false,
      });
      return true;
    },
  });
}
