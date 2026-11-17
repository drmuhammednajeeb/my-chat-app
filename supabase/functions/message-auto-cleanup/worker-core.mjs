export async function runMessageCleanupBatch(client, { limit = 100 } = {}) {
  const { data: claimed, error: claimError } = await client.rpc(
    "claim_message_cleanup_batch",
    { p_limit: limit }
  );
  if (claimError) throw new Error("claim_message_cleanup_batch failed: " + claimError.message);

  const rows = Array.isArray(claimed) ? claimed : [];
  if (!rows.length) {
    return { claimed: 0, completed: 0, storageObjectsRemoved: 0, retryScheduled: false };
  }

  const queueIds = [...new Set(rows.map(row => Number(row.queue_id)).filter(Number.isFinite))];
  if (!queueIds.length) throw new Error("Cleanup claim returned no valid queue IDs");

  const paths = [...new Set(
    rows
      .filter(row => row.storage_deleted !== true && typeof row.attachment_path === "string" && row.attachment_path.length > 0)
      .map(row => row.attachment_path)
  )];

  if (paths.length) {
    const { error: storageError } = await client.storage.from("chat-media").remove(paths);
    if (storageError) {
      const { error: releaseError } = await client.rpc("release_message_cleanup_batch", {
        p_queue_ids: queueIds,
        p_error: String(storageError.message || "Storage API removal failed").slice(0, 500)
      });
      if (releaseError) {
        throw new Error("Storage removal failed and queue release failed: " + releaseError.message);
      }
      return {
        claimed: rows.length,
        completed: 0,
        storageObjectsRemoved: 0,
        retryScheduled: true
      };
    }
  }

  const { error: markError } = await client.rpc("mark_message_cleanup_storage_deleted", {
    p_queue_ids: queueIds
  });
  if (markError) throw new Error("mark_message_cleanup_storage_deleted failed: " + markError.message);

  const { data: completed, error: completeError } = await client.rpc("complete_message_cleanup_batch", {
    p_queue_ids: queueIds
  });
  if (completeError) throw new Error("complete_message_cleanup_batch failed: " + completeError.message);

  return {
    claimed: rows.length,
    completed: Number(completed || 0),
    storageObjectsRemoved: paths.length,
    retryScheduled: false
  };
}
