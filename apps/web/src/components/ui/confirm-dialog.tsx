"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

// FEAT-028: one confirm for every destructive or risky action (docs/DESIGN.md: "Destructive actions need
// confirmation"). A native modal <dialog>: focus stays inside, Escape cancels, focus returns to the button after.
// Usage: const [confirm, dialog] = useConfirm(); ... if (!(await confirm({ title, body, action }))) return; ... {dialog}

export type ConfirmOptions = {
  title: string;
  /** The consequence in one or two plain sentences. */
  body?: ReactNode;
  /** The confirming button's label, e.g. "Revoke key". */
  action: string;
  /** Red confirming button for actions that remove or stop something. */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );
  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );
  const node = pending ? <ConfirmDialog key="confirm" {...pending} onClose={close} /> : null;
  return [confirm, node];
}

export function ConfirmDialog({
  title,
  body,
  action,
  danger = false,
  onClose,
}: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dialog && !dialog.open) dialog.showModal?.();
    // The safe choice has focus first.
    cancel.current?.focus();
    return () => opener?.focus?.();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose(false);
      }}
    >
      <h2 id="confirm-title" className="section-title m0">
        {title}
      </h2>
      {body ? <div className="muted">{body}</div> : null}
      <div className="row gap-8 confirm-actions">
        <button ref={cancel} type="button" className="btn btn-ghost" onClick={() => onClose(false)}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? "btn btn-danger" : "btn btn-primary"}
          onClick={() => onClose(true)}
        >
          {action}
        </button>
      </div>
    </dialog>
  );
}
