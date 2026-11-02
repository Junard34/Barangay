import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyComplaintWithPython } from './mlClassifier.js';

describe('Python complaint classifier client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the Python prediction and matching category routing metadata', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ predicted_category: 'Drug Abuse' }),
    });
    vi.stubGlobal('fetch', fetch);

    const triage = await classifyComplaintWithPython('A person is selling shabu nearby.');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/classify-complaint$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ complaint_text: 'A person is selling shabu nearby.' }),
      })
    );
    expect(triage.category).toBe('Drug Abuse');
    expect(triage.channel).toBe('Drug Abuse');
    expect(triage.modelType).toBe('Python TF-IDF + LinearSVC');
  });

  it('rejects categories outside the approved set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ predicted_category: 'Theft & Robbery' }),
    }));

    await expect(classifyComplaintWithPython('A bike was stolen.'))
      .rejects.toThrow('unsupported category');
  });

  it('reports an unavailable Python service instead of silently using another model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

    await expect(classifyComplaintWithPython('A complaint description.'))
      .rejects.toThrow('Python complaint classifier is unavailable');
  });
});
