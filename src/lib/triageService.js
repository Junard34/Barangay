import { TRIAGE_TRAINING_DATA } from './triageTrainingData.js';

// Multinomial Naive Bayes trained from the curated multilingual examples.
// The description is the only input to the classifier; location is not a label signal.

// Approved categories for AI triage and complaint routing.
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

export const ALL_CATEGORIES = [
  ...CHANNELS,
  'Theft & Robbery',
  'Scams & Fraud',
  'Dispute/Conflict',
  'Animal Concerns',
];

export const CATEGORY_GUIDANCE = {
  'Safety Rules': 'Violations of barangay ordinances or safety rules, including curfew violations, illegal parking, unsafe fireworks, speeding, or blocked emergency routes.',
  'Damaged Infrastructures': 'Broken, vandalized, or unsafe public roads, bridges, sidewalks, drainage, streetlights, water pipes, or community facilities that need repair.',
  'Medical Assistance': 'An illness or injury requiring first aid, an ambulance, a doctor, or support from a clinic or health center.',
  'Noise Complaints': 'Excessive or repeated noise disturbing residents, such as loud music, karaoke, construction, or late-night shouting.',
  'Drug Abuse': 'Suspected illegal drug use, possession, sale, or distribution in the community.',
  Threats: 'Threats, intimidation, stalking, or unwanted harassment made in person or through calls and messages, when no physical attack happened.',
  Cyberbullying: 'Online harassment or bullying only, including abusive messages, humiliating posts, repeated insults, or harmful content shared on social media.',
  'Physical Assault': 'A physical attack or violence, such as hitting, punching, kicking, or fighting, when the attack itself is the main concern.',
  'Theft & Robbery': 'Reports of stolen or taken property, including snatching, burglary, robbery, missing belongings, or thieves operating in the community.',
  'Scams & Fraud': 'Reports of swindling or dishonesty for money or property, such as estafa, fake sellers, fake products, fake fees, or money schemes.',
  'Dispute/Conflict': 'Reports of verbal quarrels, family or neighbor disputes, boundary or money disagreements requiring mediation.',
  'Animal Concerns': 'Reports about stray, loose, or aggressive animals, such as dog bites or animals roaming the road, when urgent medical care is not the main request.',
};

export const CATEGORY_PRIORITY = {
  'Safety Rules': 'MEDIUM',
  'Damaged Infrastructures': 'MEDIUM',
  'Medical Assistance': 'HIGH',
  'Noise Complaints': 'LOW',
  'Drug Abuse': 'HIGH',
  Threats: 'HIGH',
  Cyberbullying: 'HIGH',
  'Physical Assault': 'HIGH',
  'Theft & Robbery': 'HIGH',
  'Scams & Fraud': 'MEDIUM',
  'Dispute/Conflict': 'MEDIUM',
  'Animal Concerns': 'LOW',
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
  'Theft & Robbery': 'TANOD',
  'Scams & Fraud': 'LUPON',
  'Dispute/Conflict': 'LUPON',
  'Animal Concerns': 'TANOD',
};

export const AI_CONFIDENCE_THRESHOLD = 0.65;

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-zñ\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

const MODEL_STOP_WORDS = new Set([
  'the', 'this', 'that', 'with', 'from', 'please', 'here', 'there', 'very', 'while',
  'and', 'but', 'for', 'because', 'about', 'after', 'before', 'during', 'into',
  'was', 'were', 'are', 'is', 'has', 'have', 'had', 'been', 'being', 'does', 'did',
  'you', 'your', 'they', 'them', 'their', 'she', 'her', 'him', 'his', 'our', 'us',
  'ako', 'ikaw', 'siya', 'kami', 'kayo', 'sila', 'nila', 'niya', 'amin', 'atin',
  'ang', 'mga', 'ng', 'kay', 'sa', 'para', 'nang', 'din', 'rin', 'po', 'nga',
  'kamo', 'amo', 'imong', 'iyang', 'among', 'mi', 'ko', 'og', 'ug', 'nga',
  'barangay', 'neighbor', 'neighbors', 'resident', 'residents', 'person', 'people',
]);

function extractFeatures(text) {
  const words = tokenize(text).filter((word) => !MODEL_STOP_WORDS.has(word));
  const result = [...words];
  for (let size = 2; size <= 3; size += 1) {
    for (let index = size - 1; index < words.length; index += 1) {
      result.push(`${size}gram:${words.slice(index - size + 1, index + 1).join('_')}`);
    }
  }
  return result;
}

function trainNaiveBayes(examples) {
  const documentCounts = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
  const featureCounts = Object.fromEntries(CHANNELS.map((channel) => [channel, new Map()]));
  const featureTotals = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
  const vocabulary = new Set();

  for (const example of examples) {
    if (!Object.prototype.hasOwnProperty.call(documentCounts, example.channel) || !example.text.trim()) {
      throw new Error('Invalid entry in the complaint triage training data.');
    }

    documentCounts[example.channel] += 1;
    for (const feature of extractFeatures(example.text)) {
      vocabulary.add(feature);
      const counts = featureCounts[example.channel];
      counts.set(feature, (counts.get(feature) || 0) + 1);
      featureTotals[example.channel] += 1;
    }
  }

  if (CHANNELS.some((channel) => documentCounts[channel] === 0)) {
    throw new Error('Complaint triage training data must include every approved category.');
  }

  const alpha = 1;
  const logPrior = {};
  const logLikelihood = {};
  const vocabularySize = vocabulary.size;
  const totalDocuments = examples.length;

  for (const channel of CHANNELS) {
    logPrior[channel] = Math.log(documentCounts[channel] / totalDocuments);
    logLikelihood[channel] = new Map();
    const denominator = featureTotals[channel] + alpha * vocabularySize;
    for (const feature of vocabulary) {
      const count = featureCounts[channel].get(feature) || 0;
      logLikelihood[channel].set(feature, Math.log((count + alpha) / denominator));
    }
  }

  return { logPrior, logLikelihood };
}

// Language markers (heuristic only — shared words like droga/ospital/videoke
// are deliberately excluded as neutral). Used for display + per-language
// accuracy tracking, never to override the channel decision.
const LANGUAGE_MARKERS = {
  en: ['the', 'this', 'that', 'with', 'from', 'please', 'here', 'there', 'very', 'loud', 'noise', 'threat', 'fight', 'road', 'hospital', 'drug', 'online', 'attack', 'danger', 'emergency', 'music', 'message'],
  tl: ['ako', 'ikaw', 'kami', 'kayo', 'sila', 'hindi', 'meron', 'mayroon', 'dito', 'diyan', 'doon', 'opo', 'maingay', 'nananakot', 'tinakot', 'sinaktan', 'suntok', 'pinahiya', 'kalsada', 'paaralan', 'ospitan', 'eskwela', 'nagbebenta', 'gumagamit'],
  ceb: ['kamo', 'dili', 'naa', 'naay', 'dinhi', 'dinhang', 'didto', 'saba', 'guba', 'kulata', 'gikulata', 'sumbag', 'gisumbag', 'panumbag', 'siyag', 'bisan', 'gihilabtan', 'bugno', 'hadlok', 'gihadlok', 'libak', 'gilibak', 'tabang', 'sakit', 'panghulga', 'singgit', 'dalan', 'suga', 'tambal', 'namaligya', 'pakaulaw', 'gipakaulaw', 'daot', 'gidaot', 'dunggab', 'gubot', 'masakiton', 'hulga', 'kasaba', 'bunalan', 'gibunalan', 'lagda', 'balaod', 'kaayo', 'karon', 'ugma', 'gahapon', 'among', 'kanako'],
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

const trainedModel = trainNaiveBayes(TRIAGE_TRAINING_DATA);

function nbScores(features) {
  const scores = {};
  for (const channel of CHANNELS) {
    let score = trainedModel.logPrior[channel];
    const likelihoods = trainedModel.logLikelihood[channel];
    for (const feature of features) {
      score += likelihoods.get(feature) || 0;
    }
    scores[channel] = score;
  }
  return scores;
}

// Lowercases and strips punctuation so keyword rules behave the same in
// English, Tagalog, and Bisaya (hyphens/apostrophes become spaces).
function normalizeForRules(text) {
  return text
    .toLowerCase()
    .replace(/[^a-zñ\s]/gi, ' ')
    .replace(/\s+/g, ' ');
}

function hasExplicitSafetyRulesSignal(text) {
  const normalized = normalizeForRules(text);

  return /\b(?:safety|barangay|community)\s+(?:rules?|regulations?|ordinances?)\b|\b(?:curfew|fire lane|fire exit|emergency exit|emergency route|evacuation route|ambulance route|speed limit|ordinansa|lagda|balaod|dalan sa ambulansya|agianan sa ambulansya|daanan ng ambulansya|fireworks?|firecrackers?|paputok|illegal\s+parking|no\s+parking)\b|\b(?:bawal\s+na\s+lug(?:ar)?|bawal\s+(?:na\s+)?(?:pagparada|magparada|parada))\b|\b(?:nagsunog|sunog|pagsusunog|pag\s+sunog)\s+ng\s+basura\b|\bburning\s+(?:trash|garbage|rubbish|waste)\b|\b(?:violation|violations)\s+of\s+(?:(?:the|a)\s+)?(?:(?:safety|barangay|community)\s+)?(?:rules?|regulations?|ordinances?)\b|\b(?:break\w*|violat\w*|ignor\w*|disobey\w*)\s+(?:(?:the|a)\s+)?(?:(?:safety|barangay|community)\s+){0,2}(?:rules?|regulations?|ordinances?)\b/.test(normalized);
}

function hasExplicitDrugAbuseSignal(text) {
  const normalized = normalizeForRules(text);

  return /\b(?:shabu|marijuana|cocaine|methamphetamine|narcotics?|drug abuse|drug related (?:activity|activities|concern|concerns|incident|incidents)|illegal drugs?|droga)\b|\b(?:illegal|illicit|prohibited|bawal|ilegal)\s+(?:(?:na|nga)\s+)?(?:drugs?|substances?|gamot|tambal|droga)\b|\b(?:sell\w*|use\w*|distribut\w*|buy\w*)\s+(?:illegal\s+)?drugs?\b/.test(normalized);
}

function hasExplicitMedicalAssistanceSignal(text) {
  const normalized = normalizeForRules(text);

  const directMedicalRequest =
    /\b(?:medical\s+(?:assistance|help|attention|care|treatment)|first\s+aid|emergency\s+medical\s+(?:team|help)|tulong\s+medikal|tabang\s+medikal)\b/.test(normalized);
  const careRequest =
    /\b(?:need(?:s|ed)?|require(?:s|d)?|request(?:s|ed|ing)?|call(?:s|ed|ing)?|send|bring|take|transport(?:ed|ing)?|kailangan|kinahanglan|nanginahanglan)\b.{0,60}\b(?:medical|doctor|hospital|clinic|health center|emergency room|ambulance|paramedic|first aid|ambulansya|doktor|ospital)\b|\b(?:medical|doctor|hospital|clinic|health center|emergency room|ambulance|paramedic|first aid|ambulansya|doktor|ospital)\b.{0,60}\b(?:need(?:s|ed)?|require(?:s|d)?|urgent|kailangan|kinahanglan|nanginahanglan)\b/.test(normalized);
  const urgentSymptoms =
    /\b(?:difficulty breathing|trouble breathing|cannot breathe|can t breathe|asthma attack|high fever|chest pain|collapsed|fainted|unconscious|nahihirapang huminga|hirap huminga|nilalagnat|hinimatay|nahilo|lisod ginhawa|taas kaayo og hilanat)\b/.test(normalized);

  return directMedicalRequest || careRequest || urgentSymptoms;
}

// Swindling / estafa keywords. Deliberately excludes bare "peke/fake" because a
// fake social media account used to shame someone is Cyberbullying, not fraud;
// only fake goods/money transactions count as fraud.
// Broken or clogged public facilities: streetlights, drainage, roads, pipes.
function hasExplicitDamagedSignal(text) {
  const normalized = normalizeForRules(text);

  return /\b(?:streetlights?|street\s+lights?|drainage|kanal|culo|potholes?|waiting\s+shed|floodwaters?|water\s+main|faucet)\b/.test(normalized)
    || /\b(?:flooded|binaha|bumabaha|bumaha|nagbaha|nagbabaha|barado|bumigay|nabuak)\b/.test(normalized)
    || /\b(?:no|walang)\s+(?:water|tubig)\b|\bnawalan\s+(?:ng\s+)?(?:water|tubig)\b/.test(normalized);
}

// Threats, intimidation, stalking, or unwanted harassment when no physical
// attack happened. Suppressed when a physical attack is reported (stays
// Physical Assault) and when the harassment happened only on social media
// (stays Cyberbullying).
function hasExplicitThreatSignal(text) {
  const normalized = normalizeForRules(text);

  const reportsPhysicalAttack =
    /\b(?:punch\w*|slap\w*|kick\w*|struck|strike|hitting|hit|attack\w*|assault\w*|beat\w*|beaten|fight\w*)\b/.test(normalized)
    || /sinuntok|suntok|sinampal|sampal|sinapak|sinipa|sinaktan|sumbag|gisumbag|gisagpa|gikulata|kulata|panumbag|bugbogan|nanuntok/.test(normalized);
  if (reportsPhysicalAttack) return false;

  const onlineOnly =
    /\b(?:facebook|messenger|twitter|instagram|tiktok|viber|whatsapp|social\s+media|online|group\s+chat|comment\w*|post\w*|account)\b/.test(normalized);
  if (onlineOnly) return false;

  return /\b(?:threats?|threaten\w*|intimidat\w*|harass\w*|stalk\w*|spying|spies|spy)\b/.test(normalized)
    || /\b(?:banta|nagbanta|nagbabanta|nagbabantang|hulga|gihulga|nagpanghulga|nananakot|tinatakot|nagtatakot|hadlok|gihadlok|mananakot)\b/.test(normalized)
    || /\b(?:sumusunod|susunod|gisunod|nanununod)\b|\bfollowing\s+(?:me|her|him|us|them|my|our|the)\b/.test(normalized);
}

// Taken or stolen property (snatching, burglary, robbery).
// A physical attack, but only when the description is not a threat without
// physical contact ("threatened to punch me", "never touched", "wala man...").
function hasExplicitPhysicalAssaultSignal(text) {
  const normalized = normalizeForRules(text);
  const isOnlyAThreat =
    /threat|banta|hulga|hadlok|nananakot|tinatakot|nagbabanta|sasaktan|manakit|pananakit|intimidat/.test(normalized)
    || /\b(?:never|nobody|no\s+one|did\s+not|without\s+hitting)\b.{0,60}\b(?:touch|hit|attack|struck|contact)\b/.test(normalized)
    || /\bwala\s+(?:naman|siyang|man|pa\s+siya|niya)\b/.test(normalized);
  if (isOnlyAThreat) return false;

  return /\b(?:punch\w*|slap\w*|kick\w*|struck|strike|hitting|hit|attack\w*|assault\w*|beat\w*|beaten|fight\w*)\b/.test(normalized)
    || /sinuntok|suntok|sinampal|sampal|sinapak|sinipa|sinaktan|sumbag|gisumbag|gisagpa|gikulata|kulata|panumbag|bugbogan|nanuntok/.test(normalized);
}

// Stray / loose / aggressive animals. Bare "dog/aso/iro" is intentionally not a
// signal: a barking dog at midnight stays a Noise Complaint.
export function triageComplaint(description, _address = '') {
  const text = Array.isArray(description) ? description.join(' ') : (description || '');
  const scores = nbScores(extractFeatures(text));
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const maxScore = Math.max(...Object.values(scores));
  // Explicit keyword rules run first (most reliable), weakest signal last.
  const channel = hasExplicitSafetyRulesSignal(text)
    ? 'Safety Rules'
    : hasExplicitDamagedSignal(text)
      ? 'Damaged Infrastructures'
      : hasExplicitDrugAbuseSignal(text)
        ? 'Drug Abuse'
        : hasExplicitMedicalAssistanceSignal(text)
          ? 'Medical Assistance'
          : hasExplicitPhysicalAssaultSignal(text)
            ? 'Physical Assault'
            : hasExplicitThreatSignal(text)
              ? 'Threats'
              : ranked[0][0];
  const totalProbability = CHANNELS.reduce(
    (total, name) => total + Math.exp(scores[name] - maxScore),
    0
  );
  const confidence = Math.exp(scores[channel] - maxScore) / totalProbability;
  const priority = CATEGORY_PRIORITY[channel] || 'MEDIUM';

  return {
    channel,
    category: channel, // alias: categories == channels in this system
    priority,
    confidence,
    needsReview: confidence < AI_CONFIDENCE_THRESHOLD,
    suggestedRole: CHANNEL_ROLE_MAP[channel] || 'OFFICIAL',
    language: detectLanguage(text),
  };
}
