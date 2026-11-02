export function getTriageModelType(categorySource, hasAppliedCategorySource) {
  if (!hasAppliedCategorySource) {
    return 'Naive Bayes';
  }

  if (categorySource === 'ml') {
    return 'Python TF-IDF + LinearSVC category; Naive Bayes base-triage confidence';
  }

  if (categorySource === 'citizen') {
    return 'Citizen-selected category; Naive Bayes base-triage confidence';
  }

  return 'Client-provided category; Naive Bayes base-triage confidence';
}
