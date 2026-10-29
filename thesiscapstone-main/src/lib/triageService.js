// AI triage: description (+ auxiliary incident-address signal) -> 1 of 8 channels.
// Current engine: TF-IDF-style keyword prior (offline, zero deps).
// Upgrade path: train a Multinomial Naive Bayes offline (scikit-learn),
// export log-prob weights JSON, and plug them via setModelWeights() below —
// the return shape { channel, category, priority, confidence, needsReview }
// stays identical so no UI/backend rewiring is needed.

export const CHANNELS = [
  'Safety Rules',
  'Damaged Infrastructures',
  'Medical Assistance',
  'Noise Complaints',
  'Drug Abuse',
  'Threats',
  'Cyberbullying',
  'Physical Assault',
];

// Keywords are intentionally trilingual (English + Tagalog + Bisaya/Cebuano).
// Bisaya markers were drafted from lexicons and MUST be validated by native
// speakers / barangay staff — wrong words silently misroute complaints.
const channelKeywords = {
  'Safety Rules': ['safety', 'rule', 'ordinance', 'curfew', 'violation', 'unsafe', 'security', 'public safety', 'lagda', 'balaod', 'delikado', 'bantay', 'gilapas', 'nilapas'],
  'Damaged Infrastructures': ['road', 'drainage', 'flood', 'street', 'water', 'waste', 'electricity', 'light', 'bridge', 'infrastructure', 'damaged', 'repair', 'binaha', 'lubak', 'sirang', 'guba', 'nangaguba', 'dalan', 'karsada', 'suga', 'ngitngit', 'tulay', 'basura', 'tubig', 'baha'],
  'Medical Assistance': ['clinic', 'dengue', 'sick', 'medical', 'hospital', 'health', 'sanitation', 'mosquito', 'emergency', 'ambulance', 'ospital', 'may sakit', 'emergency', 'sakit', 'masakiton', 'nagkasakit', 'tabang', 'motabang', 'tambal', 'doktor', 'pasyente'],
  'Noise Complaints': ['loud', 'noise', 'music', 'barking', 'disturbance', 'videoke', 'nuisance', 'maingay', 'ingay', 'saba', 'kasaba', 'gubot', 'singgit', 'siyagit', 'kusog', 'saba kaayo', 'banha'],
  'Drug Abuse': ['drug', 'shabu', 'marijuana', 'illegal drugs', 'sale', 'use', 'addict', 'droga', 'nagbebenta', 'gumagamit', 'gagamit', 'namaligya', 'namaligyaay', 'adik', 'tulak'],
  Threats: ['threat', 'harass', 'intimidate', 'attack', 'violent', 'threatening', 'tinakot', 'binantaan', 'nananakot', 'hadlok', 'gihadlok', 'gipanghadlok', 'mahadlok', 'panghulga', 'hulga', 'gihulga', 'pasidaan'],
  Cyberbullying: ['bully', 'harassment', 'taunt', 'humiliate', 'threatening messages', 'online', 'cyber', 'post', 'chat', 'facebook', 'message', 'pinahiya', 'libak', 'gilibak', 'pakaulaw', 'gipakaulawan', 'daot', 'gidaot', 'tsismis', 'screenshot', 'gi-post'],
  'Physical Assault': ['fight', 'assault', 'punch', 'harm', 'robbery', 'gun', 'drunk', 'danger', 'sinaktan', 'bugbog', 'away', 'suntok', 'kulata', 'gikulata', 'kusi', 'sumbag', 'gisumbag', 'sinumbagay', 'bugno', 'nakigbugno', 'bunalan', 'gibunalan', 'dunggab', 'gidunggab', 'tigbas'],
};

const priorityByChannel = {
  'Safety Rules': 'MEDIUM',
  'Damaged Infrastructures': 'MEDIUM',
  'Medical Assistance': 'HIGH',
  'Noise Complaints': 'LOW',
  'Drug Abuse': 'HIGH',
  Threats: 'HIGH',
  Cyberbullying: 'HIGH',
  'Physical Assault': 'HIGH',
};

// Which staff role primarily handles each channel (role pools, no fixed roster).
export const CHANNEL_ROLE_MAP = {
  'Safety Rules': 'TANOD',
  'Damaged Infrastructures': 'OFFICIAL',
  'Medical Assistance': 'OFFICIAL',
  'Noise Complaints': 'LUPON',
  'Drug Abuse': 'TANOD',
  Threats: 'TANOD',
  Cyberbullying: 'LUPON',
  'Physical Assault': 'TANOD',
};

export const AI_CONFIDENCE_THRESHOLD = 0.65;

// Optional trained NB weights: { logPrior: {channel: n}, logLikelihood: {channel: {token: n}} }
// When present, scores = logPrior + sum(logLikelihood) blended with keyword scores.
let trainedWeights = null;

export function setModelWeights(weights) {
  trainedWeights = weights;
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-zñ\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function keywordScores(normalized) {
  const scores = {};
  for (const [name, keywords] of Object.entries(channelKeywords)) {
    scores[name] = keywords.reduce((total, kw) => total + (normalized.includes(kw) ? 1 : 0), 0);
  }
  return scores;
}

// Address is an auxiliary signal only: the channel comes from the description.
// Location hints (English, Tagalog, Bisaya) add a small bonus, never override text.
function addressBonus(address) {
  const a = (address || '').toLowerCase();
  if (!a.trim()) return {};
  const bonus = {};
  if (/(hospital|clinic|center|health|ospital|tambalanan)/.test(a)) bonus['Medical Assistance'] = (bonus['Medical Assistance'] || 0) + 1;
  if (/(school|esk well|eskwela|eskwelahan|paaralan|tunghaan)/.test(a)) bonus['Safety Rules'] = (bonus['Safety Rules'] || 0) + 0.5;
  if (/(road|street|bridge|drainage|kalsada|tulay|dalan|karsada|suga|taytayan)/.test(a)) bonus['Damaged Infrastructures'] = (bonus['Damaged Infrastructures'] || 0) + 0.5;
  return bonus;
}

// Language markers (heuristic only — shared words like droga/ospital/videoke
// are deliberately excluded as neutral). Used for display + per-language
// accuracy tracking, never to override the channel decision.
const LANGUAGE_MARKERS = {
  en: ['the', 'this', 'that', 'with', 'from', 'please', 'here', 'there', 'very', 'loud', 'noise', 'threat', 'fight', 'road', 'hospital', 'drug', 'online', 'attack', 'danger', 'emergency', 'music', 'message'],
  tl: ['ako', 'ikaw', 'kami', 'kayo', 'sila', 'hindi', 'meron', 'mayroon', 'dito', 'diyan', 'doon', 'opo', 'maingay', 'nananakot', 'tinakot', 'sinaktan', 'suntok', 'pinahiya', 'kalsada', 'paaralan', 'ospitan', 'eskwela', 'nagbebenta', 'gumagamit'],
  ceb: ['kamo', 'dili', 'naa', 'naay', 'dinhi', 'dinhang', 'didto', 'saba', 'guba', 'kulata', 'gikulata', 'sumbag', 'gisumbag', 'bugno', 'hadlok', 'gihadlok', 'libak', 'gilibak', 'tabang', 'sakit', 'panghulga', 'singgit', 'dalan', 'suga', 'tambal', 'namaligya', 'pakaulaw', 'gipakaulaw', 'daot', 'gidaot', 'dunggab', 'gubot', 'masakiton', 'hulga', 'kasaba', 'bunalan', 'gibunalan', 'lagda', 'balaod', 'kaayo', 'karon', 'ugma', 'gahapon', 'among', 'kanako'],
};

export const LANGUAGE_LABELS = { en: 'English', tl: 'Tagalog', ceb: 'Bisaya', mixed: 'Mixed' };

export function detectLanguage(text) {
  const words = new Set(tokenize(text));
  if (words.size === 0) return 'mixed';
  const scores = { en: 0, tl: 0, ceb: 0 };
  for (const lang of Object.keys(scores)) {
    for (const marker of LANGUAGE_MARKERS[lang]) {
      if (words.has(marker)) scores[lang] += 1;
    }
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === 0) return 'mixed';
  if (ranked[0][1] === ranked[1][1]) return 'mixed';
  return ranked[0][0];
}

function nbScores(tokens) {
  if (!trainedWeights) return null;
  const scores = {};
  for (const channel of CHANNELS) {
    let s = trainedWeights.logPrior?.[channel] ?? Math.log(1 / CHANNELS.length);
    const ll = trainedWeights.logLikelihood?.[channel] || {};
    for (const t of tokens) {
      if (ll[t] !== undefined) s += ll[t];
    }
    scores[channel] = s;
  }
  return scores;
}

export function triageComplaint(description, address = '') {
  const text = Array.isArray(description) ? description.join(' ') : (description || '');
  const normalized = text.toLowerCase();
  const tokens = tokenize(`${text} ${address || ''}`);

  const kw = keywordScores(normalized);
  const bonus = addressBonus(address);
  const combined = {};
  for (const channel of CHANNELS) {
    combined[channel] = (kw[channel] || 0) + (bonus[channel] || 0);
  }

  const nb = nbScores(tokens);
  if (nb) {
    // Blend: trained model dominates (x3), keyword prior breaks ties.
    const nbMin = Math.min(...Object.values(nb));
    for (const channel of CHANNELS) {
      combined[channel] += (nb[channel] - nbMin) * 3;
    }
  }

  let channel = 'Safety Rules';
  let best = -Infinity;
  let second = -Infinity;
  for (const [name, score] of Object.entries(combined)) {
    if (score > best) {
      second = best;
      best = score;
      channel = name;
    } else if (score > second) {
      second = score;
    }
  }

  const margin = best - second;
  const confidence = Math.min(0.99, Math.max(0.5, 0.55 + best * 0.08 + margin * 0.05));
  const priority = priorityByChannel[channel] || 'MEDIUM';

  return {
    channel,
    category: channel, // alias: categories == channels in this system
    priority,
    confidence,
    needsReview: confidence < AI_CONFIDENCE_THRESHOLD,
    suggestedRole: CHANNEL_ROLE_MAP[channel] || 'OFFICIAL',
    language: detectLanguage(`${text} ${address || ''}`),
  };
}
