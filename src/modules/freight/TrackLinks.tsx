'use client';
// Manual web-tracking helper for a container: pick a line, open its tracking page
// (pre-filled with the container number where the carrier URL supports it), and copy
// the number for sites that need pasting. For lines we don't call via API — the
// operator reads the ETA on the carrier site and records it back with "Record".
import { useState } from 'react';

export interface TrackOption { key: string; name: string; track: string }

function buildUrl(tmpl: string, n: string): string {
  return tmpl.includes('{n}') ? tmpl.replace('{n}', encodeURIComponent(n.trim())) : tmpl;
}

export function TrackLinks({ containerNo, options }: { containerNo: string | null; options: TrackOption[] }) {
  const [key, setKey] = useState(options[0]?.key ?? 'manual');
  const [copied, setCopied] = useState(false);
  const opt = options.find((o) => o.key === key) ?? options[0];
  const num = (containerNo ?? '').trim();
  const url = opt ? buildUrl(opt.track, num) : '#';

  async function copy() {
    if (!num) return;
    try {
      await navigator.clipboard.writeText(num);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the number is shown in the field to copy by hand */
    }
  }

  return (
    <div className="row" style={{ gap: 6, alignItems: 'end', flexWrap: 'wrap' }}>
      <div className="field">
        <label className="label">Open carrier site</label>
        <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
          {options.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
        </select>
      </div>
      <a
        className="btn btn-ghost btn-sm"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!num}
        style={!num ? { pointerEvents: 'none', opacity: 0.5 } : undefined}
      >
        Track ↗
      </a>
      <button type="button" className="btn btn-ghost btn-sm" onClick={copy} disabled={!num}>
        {copied ? 'Copied ✓' : 'Copy no.'}
      </button>
    </div>
  );
}
