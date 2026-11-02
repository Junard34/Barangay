import { CATEGORY_GUIDANCE, triageComplaint } from '../lib/triageService';

export default function ComplaintCategoryPreview({ description }) {
  const words = description.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;

  const triage = triageComplaint(description);

  return (
    <div
      aria-live="polite"
      className={`mt-2 rounded-lg border p-3 text-sm ${
        triage.needsReview
          ? 'border-amber-200 bg-amber-50 text-amber-800'
          : 'border-blue-200 bg-blue-50 text-blue-800'
      }`}
    >
      <p>
        AI category suggestion: <strong>{triage.category}</strong>
        {' '}({(triage.confidence * 100).toFixed(0)}% confidence, {triage.priority} priority)
      </p>
      <p className="mt-1 text-xs">{CATEGORY_GUIDANCE[triage.category]}</p>
      {triage.needsReview && (
        <p className="mt-1 text-xs font-medium">
          This description is unclear to the classifier. Barangay staff should review the category.
        </p>
      )}
    </div>
  );
}
