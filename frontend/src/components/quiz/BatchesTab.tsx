"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { SelectInput } from "@/components/ui/Field";
import { DocumentIcon, MoreIcon } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";
import { formatDate, shortId } from "@/lib/format";
import {
  deleteBatch,
  saveBatch,
  type Batch,
  type SectionWithCount,
} from "@/lib/workspace";

export interface BatchesTabProps {
  quizId: string;
  batches: Batch[];
  sections: SectionWithCount[];
  batchCounts: Record<string, number>;
  activeBatchId: string | null;
  onCreateBatch: () => Promise<void>;
  onOpenBatch: (batch: Batch) => void;
  onReload: (preferredBatchId?: string | null) => Promise<void>;
}

export function BatchesTab({
  quizId,
  batches,
  sections,
  batchCounts,
  activeBatchId,
  onCreateBatch,
  onOpenBatch,
  onReload,
}: BatchesTabProps) {
  const { push: pushToast } = useToast();
  const [batchMenuId, setBatchMenuId] = useState<string | null>(null);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState<Batch | null>(
    null,
  );
  const [deletingBatch, setDeletingBatch] = useState(false);

  async function handleUpdateBatchSection(
    batchId: string,
    sectionId: string | null,
  ) {
    try {
      await saveBatch({ id: batchId, quizId, sectionId });
      await onReload(activeBatchId);
      pushToast("Batch class updated.", "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not update batch.",
        "error",
      );
    }
  }

  async function handleDeleteBatchConfirm() {
    if (!deleteBatchTarget || deletingBatch) return;
    setDeletingBatch(true);
    try {
      const deletedId = deleteBatchTarget.id;
      await deleteBatch(deletedId);
      setDeleteBatchTarget(null);
      await onReload(activeBatchId === deletedId ? null : activeBatchId);
      pushToast(`Deleted batch #${shortId(deletedId)}.`, "success");
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "Could not delete batch.",
        "error",
      );
    } finally {
      setDeletingBatch(false);
    }
  }

  return (
    <div className="space-y-3">
      {batches.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon />}
          title="No batches yet"
          description="Create a batch to organize uploaded answer sheets by class."
          action={
            <Button variant="primary" onClick={() => void onCreateBatch()}>
              New batch
            </Button>
          }
        />
      ) : (
        <DataTable
          rows={batches}
          rowKey={(b) => b.id}
          columns={[
            {
              key: "created",
              header: "Created",
              render: (b) => (
                <span className="font-medium text-[var(--text-primary)]">
                  {formatDate(b.createdAt)} (#{shortId(b.id)})
                </span>
              ),
            },
            {
              key: "section",
              header: "Class",
              render: (b) => (
                <SelectInput
                  selectSize="sm"
                  aria-label={`Class for batch ${shortId(b.id)}`}
                  value={b.sectionId ?? ""}
                  onChange={(e) =>
                    void handleUpdateBatchSection(b.id, e.target.value || null)
                  }
                  className="!w-auto"
                >
                  <option value="">No class</option>
                  {sections.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {sec.name}
                      {sec.term ? ` (${sec.term})` : ""}
                    </option>
                  ))}
                </SelectInput>
              ),
            },
            {
              key: "papers",
              header: "Papers",
              align: "right",
              render: (b) => (
                <span className="font-mono tabular-nums">
                  {batchCounts[b.id] ?? 0}
                </span>
              ),
            },
          ]}
          renderActions={(b) => (
            <>
              <Button variant="ghost" size="sm" onClick={() => onOpenBatch(b)}>
                Open
              </Button>
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`More actions for batch ${shortId(b.id)}`}
                  onClick={() =>
                    setBatchMenuId((prev) => (prev === b.id ? null : b.id))
                  }
                >
                  <MoreIcon />
                </Button>
                {batchMenuId === b.id && (
                  <div
                    role="menu"
                    className="absolute right-0 z-30 mt-1 w-36 rounded-[12px] border border-[var(--border-hairline)] bg-[var(--bg-surface)] py-1 text-left"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setBatchMenuId(null);
                        setDeleteBatchTarget(b);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--danger-bg)]"
                    >
                      Delete batch
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        />
      )}

      <Dialog
        open={deleteBatchTarget !== null}
        title={`Delete batch #${deleteBatchTarget ? shortId(deleteBatchTarget.id) : ""}?`}
        description={`This permanently removes batch #${deleteBatchTarget ? shortId(deleteBatchTarget.id) : ""} (${deleteBatchTarget ? formatDate(deleteBatchTarget.createdAt) : ""}) and its ${
          deleteBatchTarget ? (batchCounts[deleteBatchTarget.id] ?? 0) : 0
        } graded paper${(deleteBatchTarget ? (batchCounts[deleteBatchTarget.id] ?? 0) : 0) === 1 ? "" : "s"} along with their aligned scan images.`}
        confirmLabel="Delete batch"
        confirmVariant="danger"
        busy={deletingBatch}
        onConfirm={() => void handleDeleteBatchConfirm()}
        onClose={() => setDeleteBatchTarget(null)}
      />
    </div>
  );
}
