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
    r"\b(?:suspected\s+)?drug[-\s]+related\s+"
    r"(?:activity|activities|concern|concerns|incident|incidents)\b",
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
    try:
        if DRUG_ACTIVITY_PATTERN.search(text):
            prediction = "Drug Abuse"
        else:
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
