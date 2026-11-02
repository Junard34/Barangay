import { useState } from 'react';
import {
  CHANNELS,
  CATEGORY_GUIDANCE,
  CATEGORY_PRIORITY,
  CHANNEL_ROLE_MAP,
} from '../lib/triageService';

const PRIORITY_STYLES = {
  HIGH: 'bg-rose-100 text-rose-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-emerald-100 text-emerald-700',
};

// Shared visual map of every complaint category (category == channel in this
// system). Shown in the citizen complaint form and the admin walk-in form so
// both sides see exactly the definitions the AI triage classifies against.
export default function ComplaintCategoryMap() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Complaint categories</p>
          <p className="text-xs text-slate-600">
            The category is chosen automatically from your description. These are the {CHANNELS.length} categories it can pick from.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {expanded ? 'Hide list' : 'Show list'}
        </button>
      </div>

      {expanded && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {CHANNELS.map((channel) => (
            <li key={channel} className="rounded-md border border-slate-200 bg-white p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-slate-900">{channel}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    PRIORITY_STYLES[CATEGORY_PRIORITY[channel]] || 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {CATEGORY_PRIORITY[channel]}
                </span>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                  {CHANNEL_ROLE_MAP[channel]}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">{CATEGORY_GUIDANCE[channel]}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
