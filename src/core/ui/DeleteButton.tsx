// DeleteButton — a small, reusable, friendly delete control. Confirms first, then
// invokes a server action with the given hidden fields. Server actions are passed in
// as props from the (server) page; the action enforces permissions + dependency rules.
'use client';

import { useTransition } from 'react';

export function DeleteButton({
  action,
  fields,
  confirm: confirmText = 'Delete this? This can’t be undone.',
  label = 'Delete',
  title,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  confirm?: string;
  label?: string;
  title?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      style={{ color: 'var(--danger)' }}
      disabled={pending}
      title={title ?? label}
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.set(k, v);
        start(() => action(fd));
      }}
    >
      {pending ? '…' : label}
    </button>
  );
}
