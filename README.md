# caprojstone

## Complaint classification

The citizen complaint form requests a category suggestion from the Python
FastAPI service. Complaint submissions use the same service and description,
so the saved category and routing match the preview and cannot be overridden
by a client-provided category. The Python service trains its TF-IDF + LinearSVC
model from the shared curated dataset at startup. Its only labels are the eight
approved categories: Safety Rules, Damaged Infrastructures, Medical Assistance,
Noise Complaints, Drug Abuse, Threats, Cyberbullying, and Physical Assault.

Install the Python dependencies once:

```sh
python -m pip install -r ml_service/requirements.txt
```

`npm run dev` starts the Python classifier with the frontend and API. It uses
`.venv` when available, otherwise it uses `python` from PATH. The classifier
URL defaults to `http://127.0.0.1:8001`; set `ML_SERVICE_URL` in `.env` to
change it. Both the JavaScript triage tests and Python model training read the
same `ml_service/training_data.json` examples.