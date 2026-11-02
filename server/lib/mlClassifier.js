import {
  CHANNELS,
  CATEGORY_PRIORITY,
  CHANNEL_ROLE_MAP,
  triageComplaint,
} from '../../src/lib/triageService.js';

const CLASSIFIER_TIMEOUT_MS = 10000;

export async function classifyComplaintWithPython(description, location = '') {
  const complaintText = (description || '').trim();
  if (!complaintText) {
    throw new Error('Complaint description is required for classification.');
  }

  const serviceUrl = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
  let response;
  try {
    response = await fetch(`${serviceUrl}/api/classify-complaint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ complaint_text: complaintText }),
      signal: AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Python complaint classifier is unavailable: ${error.message}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Python complaint classifier returned an invalid response.');
  }

  if (!response.ok) {
    throw new Error(data?.detail || data?.message || 'Python complaint classifier returned an error.');
  }

  const category = data?.predicted_category;
  if (!CHANNELS.includes(category)) {
    throw new Error(`Python complaint classifier returned an unsupported category: ${category || 'empty response'}.`);
  }

  const baseTriage = triageComplaint(complaintText, location);
  return {
    ...baseTriage,
    category,
    channel: category,
    priority: CATEGORY_PRIORITY[category],
    suggestedRole: CHANNEL_ROLE_MAP[category],
    modelType: 'Python TF-IDF + LinearSVC',
  };
}
