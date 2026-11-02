import { describe, expect, it } from 'vitest';
import { getTriageModelType } from './triageMetadata.js';

describe('triage model metadata', () => {
  it('records the Python classifier for a resolved ML category', () => {
    expect(getTriageModelType('ml', true)).toBe(
      'Python TF-IDF + LinearSVC category; Naive Bayes base-triage confidence'
    );
  });

  it('distinguishes a citizen-corrected category from a model prediction', () => {
    expect(getTriageModelType('citizen', true)).toBe(
      'Citizen-selected category; Naive Bayes base-triage confidence'
    );
  });

  it('records legacy client categories without mislabeling them as model predictions', () => {
    expect(getTriageModelType(undefined, true)).toBe(
      'Client-provided category; Naive Bayes base-triage confidence'
    );
  });

  it('labels heuristic fallback triage as Naive Bayes', () => {
    expect(getTriageModelType('ml', false)).toBe('Naive Bayes');
  });
});
