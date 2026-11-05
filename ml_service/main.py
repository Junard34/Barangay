"""Machine learning complaint classification service."""
import json
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import make_pipeline
from sklearn.svm import LinearSVC

TRAINING_DATA_PATH = Path(__file__).with_name("training_data.json")

APPROVED_CATEGORIES = {
    "Safety Rules",
    "Damaged Infrastructures",
    "Medical Assistance",
    "Noise Complaints",
    "Drug Abuse",
    "Threats",
    "Cyberbullying",
    "Physical Assault",
}
CATEGORY_ALIASES = {
    "Drug Abuses": "Drug Abuse",
    "Physical Harassment / Assault": "Physical Assault",
}
DRUG_ACTIVITY_PATTERN = re.compile(
    r"\b(?:shabu|marijuana|cocaine|methamphetamine|narcotics?|drug\s+abuse|drug\s+related\s+(?:activity|activities|concern|concerns|incident|incidents)|illegal\s+drugs?|droga)\b"
    r"|\b(?:illegal|illicit|prohibited|bawal|ilegal)\s+(?:(?:na|nga)\s+)?(?:drugs?|substances?|gamot|tambal|droga)\b"
    r"|\b(?:sell\w*|use\w*|distribut\w*|buy\w*)\s+(?:illegal\s+)?drugs?\b",
    re.IGNORECASE,
)

app = FastAPI(title="Barangay Complaint Classification Service")

model: Any = None


class ClassifyRequest(BaseModel):
    complaint_text: str = Field(..., description="Citizen complaint description")


class ClassifyResponse(BaseModel):
    predicted_category: str


def normalize_category(category: str) -> str:
    normalized = CATEGORY_ALIASES.get(category, category)
    if normalized not in APPROVED_CATEGORIES:
        raise ValueError(f"Model returned an unapproved category: {category}")
    return normalized


def _normalize_for_rules(text: str) -> str:
    return re.sub(r"[^a-z\s]", " ", (text or "").lower())


def _has_safety(text: str) -> bool:
    n = _normalize_for_rules(text)
    pattern = (
        r"\b(?:safety|barangay|community)\s+(?:rules?|regulations?|ordinances?)\b"
        r"|\b(?:curfew|fire lane|fire exit|emergency exit|emergency route|evacuation route|ambulance route|speed limit|ordinansa|lagda|balaod|dalan sa ambulansya|agianan sa ambulansya|daanan ng ambulansya|fireworks?|firecrackers?|paputok|illegal\s+parking|no\s+parking)\b"
        r"|\b(?:bawal\s+na\s+lug(?:ar)?|bawal\s+(?:na\s+)?(?:pagparada|magparada|parada))\b"
        r"|\b(?:nagsunog|sunog|pagsusunog|pag\s+sunog)\s+ng\s+basura\b"
        r"|\bburning\s+(?:trash|garbage|rubbish|waste)\b"
        r"|\b(?:violation|violations)\s+of\s+(?:(?:the|a)\s+)?(?:(?:safety|barangay|community)\s+)?(?:rules?|regulations?|ordinances?)\b"
        r"|\b(?:break\w*|violat\w*|ignor\w*|disobey\w*)\s+(?:(?:the|a)\s+)?(?:(?:safety|barangay|community)\s+){0,2}(?:rules?|regulations?|ordinances?)\b"
    )
    return re.search(pattern, n, re.IGNORECASE | re.ASCII) is not None


def _has_drug(text: str) -> bool:
    n = _normalize_for_rules(text)
    pattern = (
        r"\b(?:shabu|marijuana|cocaine|methamphetamine|narcotics?|drug\s+abuse|drug\s+related\s+(?:activity|activities|concern|concerns|incident|incidents)|illegal\s+drugs?|droga)\b"
        r"|\b(?:illegal|illicit|prohibited|bawal|ilegal)\s+(?:(?:na|nga)\s+)?(?:drugs?|substances?|gamot|tambal|droga)\b"
        r"|\b(?:sell\w*|use\w*|distribut\w*|buy\w*)\s+(?:illegal\s+)?drugs?\b"
    )
    return re.search(pattern, n, re.IGNORECASE | re.ASCII) is not None


def _has_medical(text: str) -> bool:
    n = _normalize_for_rules(text)
    direct = re.search(
        r"\b(?:medical\s+(?:assistance|help|attention|care|treatment)|first\s+aid|emergency\s+medical\s+(?:team|help)|tulong\s+medikal|tabang\s+medikal)\b",
        n, re.IGNORECASE | re.ASCII)
    care = re.search(
        r"\b(?:need(?:s|ed)?|require(?:s|d)?|request(?:s|ed|ing)?|call(?:s|ed|ing)?|send|bring|take|transport(?:ed|ing)?|kailangan|kinahanglan|nanginahanglan)\b.{0,60}\b(?:medical|doctor|hospital|clinic|health\s+center|emergency\s+room|ambulance|paramedic|first\s+aid|ambulansya|doktor|ospital)\b"
        r"|\b(?:medical|doctor|hospital|clinic|health\s+center|emergency\s+room|ambulance|paramedic|first\s+aid|ambulansya|doktor|ospital)\b.{0,60}\b(?:need(?:s|ed)?|require(?:s|d)?|urgent|kailangan|kinahanglan|nanginahanglan)\b",
        n, re.IGNORECASE | re.ASCII)
    urgent = re.search(
        r"\b(?:difficulty\s+breathing|trouble\s+breathing|cannot\s+breathe|can\s+t\s+breathe|asthma\s+attack|high\s+fever|chest\s+pain|collapsed|fainted|unconscious|nahihirapang\s+huminga|hirap\s+huminga|nilalagnat|hinimatay|nahilo|lisod\s+ginhawa|taas\s+kaayo\s+og\s+hilanat)\b",
        n, re.IGNORECASE | re.ASCII)
    return any([direct, care, urgent])


def _has_damaged(text: str) -> bool:
    n = _normalize_for_rules(text)
    return (re.search(r"\b(?:streetlights?|street\s+lights?|drainage|kanal|culo|potholes?|waiting\s+shed|floodwaters?|water\s+main|faucet)\b", n, re.IGNORECASE | re.ASCII) is not None
            or re.search(r"\b(?:flooded|binaha|bumabaha|bumaha|nagbaha|nagbabaha|barado|bumigay|nabuak)\b", n, re.IGNORECASE | re.ASCII) is not None
            or re.search(r"\b(?:no|walang)\s+(?:water|tubig)\b|\bnawalan\s+(?:ng\s+)?(?:water|tubig)\b", n, re.IGNORECASE | re.ASCII) is not None)


def _has_physical(text: str) -> bool:
    n = _normalize_for_rules(text)
    threat_words = re.search(r"threat|banta|hulga|hadlok|nananakot|tinatakot|nagbabanta|sasaktan|manakit|pananakit|intimidat", n, re.IGNORECASE | re.ASCII)
    never_touch = re.search(r"\b(?:never|nobody|no\s+one|did\s+not|without\s+hitting)\b.{0,60}\b(?:touch|hit|attack|struck|contact)\b", n, re.IGNORECASE | re.ASCII)
    wala = re.search(r"\bwala\s+(?:naman|siyang|man|pa\s+siya|niya)\b", n, re.IGNORECASE | re.ASCII)
    if threat_words or never_touch or wala:
        return False
    return (re.search(r"\b(?:punch\w*|slap\w*|kick\w*|struck|strike|hitting|hit|attack\w*|assault\w*|beat\w*|beaten|fight\w*)\b", n, re.IGNORECASE | re.ASCII) is not None
            or re.search(r"sinuntok|suntok|sinampal|sampal|sinapak|sinipa|sinaktan|sumbag|gisumbag|gisagpa|gikulata|kulata|panumbag|bugbogan|nanuntok", n, re.IGNORECASE | re.ASCII) is not None)


def _has_threat(text: str) -> bool:
    n = _normalize_for_rules(text)
    physical = (re.search(r"\b(?:punch\w*|slap\w*|kick\w*|struck|strike|hitting|hit|attack\w*|assault\w*|beat\w*|beaten|fight\w*)\b", n, re.IGNORECASE | re.ASCII) is not None
                or re.search(r"sinuntok|suntok|sinampal|sampal|sinapak|sinipa|sinaktan|sumbag|gisumbag|gisagpa|gikulata|kulata|panumbag|bugbogan|nanuntok", n, re.IGNORECASE | re.ASCII) is not None)
    if physical:
        return False
    online = re.search(r"\b(?:facebook|messenger|twitter|instagram|tiktok|viber|whatsapp|social\s+media|online|group\s+chat|comment\w*|post\w*|account)\b", n, re.IGNORECASE | re.ASCII)
    if online:
        return False
    return (re.search(r"\b(?:threats?|threaten\w*|intimidat\w*|harass\w*|stalk\w*|spying|spies|spy)\b", n, re.IGNORECASE | re.ASCII) is not None
            or re.search(r"\b(?:banta|nagbanta|nagbabanta|nagbabantang|hulga|gihulga|nagpanghulga|nananakot|tinatakot|nagtatakot|hadlok|gihadlok|mananakot)\b", n, re.IGNORECASE | re.ASCII) is not None
            or re.search(r"\b(?:sumusunod|susunod|gisunod|nanununod)\b|\bfollowing\s+(?:me|her|him|us|them|my|our|the)\b", n, re.IGNORECASE | re.ASCII) is not None)


def rule_based_category(text: str):
    if _has_safety(text):
        return "Safety Rules"
    if _has_damaged(text):
        return "Damaged Infrastructures"
    if _has_drug(text):
        return "Drug Abuse"
    if _has_medical(text):
        return "Medical Assistance"
    if _has_physical(text):
        return "Physical Assault"
    if _has_threat(text):
        return "Threats"
    return None


@app.on_event("startup")
def load_model() -> None:
    global model
    if not TRAINING_DATA_PATH.is_file():
        raise RuntimeError(f"Training data file not found at {TRAINING_DATA_PATH}")

    try:
        with TRAINING_DATA_PATH.open(encoding="utf-8") as training_file:
            training_data = json.load(training_file)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not load complaint training data: {exc}") from exc

    if not isinstance(training_data, list) or not training_data:
        raise RuntimeError("Complaint training data must be a non-empty list.")
    if any(
        not isinstance(example, dict)
        or not isinstance(example.get("text"), str)
        or not example["text"].strip()
        or example.get("channel") not in APPROVED_CATEGORIES
        for example in training_data
    ):
        raise RuntimeError("Complaint training data contains an invalid text or unapproved category.")

    training_categories = {example["channel"] for example in training_data}
    if training_categories != APPROVED_CATEGORIES:
        raise RuntimeError(
            "Training data must include all eight approved complaint categories."
        )

    trained_model = make_pipeline(
        TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True),
        LinearSVC(random_state=0),
    )
    trained_model.fit(
        [example["text"] for example in training_data],
        [example["channel"] for example in training_data],
    )
    model = trained_model


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "training_data_path": str(TRAINING_DATA_PATH),
    }


@app.post("/api/classify-complaint", response_model=ClassifyResponse)
def classify_complaint(request: ClassifyRequest) -> ClassifyResponse:
    text = (request.complaint_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="complaint_text must not be empty.")
    if model is None:
        raise HTTPException(status_code=503, detail="Model is not loaded.")
    rule_category = rule_based_category(text)
    if rule_category is not None:
        prediction = rule_category
    else:
        try:
            prediction = normalize_category(str(model.predict([text])[0]))
        except ValueError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover - defensive
            raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc
    return ClassifyResponse(predicted_category=prediction)


# Convenience alias used by some clients/tests.
@app.post("/classify-complaint", response_model=ClassifyResponse)
def classify_complaint_alias(request: ClassifyRequest) -> ClassifyResponse:
    return classify_complaint(request)


@app.post("/classify", response_model=ClassifyResponse)
def classify_alias(request: ClassifyRequest) -> ClassifyResponse:
    return classify_complaint(request)
