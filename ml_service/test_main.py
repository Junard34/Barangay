import unittest

from fastapi import HTTPException

from ml_service import main


class FakeModel:
    classes_ = [
        "Safety Rules",
        "Damaged Infrastructures",
        "Medical Assistance",
        "Noise Complaints",
        "Drug Abuses",
        "Threats",
        "Cyberbullying",
        "Physical Harassment / Assault",
    ]

    def __init__(self, prediction):
        self.prediction = prediction

    def predict(self, _texts):
        return [self.prediction]


class ComplaintClassifierTests(unittest.TestCase):
    def setUp(self):
        self.original_model = main.model

    def tearDown(self):
        main.model = self.original_model

    def test_trains_model_with_eight_approved_categories(self):
        main.load_model()

        self.assertEqual(set(main.model.classes_), main.APPROVED_CATEGORIES)

    def test_normalizes_legacy_model_labels(self):
        main.model = FakeModel("Physical Harassment / Assault")

        result = main.classify_complaint(main.ClassifyRequest(complaint_text="Assault report"))

        self.assertEqual(result.predicted_category, "Physical Assault")

    def test_trained_model_matches_representative_descriptions(self):
        main.load_model()
        examples = {
            "Residents are violating the barangay curfew after allowed hours.": "Safety Rules",
            "A pothole and broken streetlight make the road unsafe.": "Damaged Infrastructures",
            "An elderly resident needs an ambulance for difficulty breathing.": "Medical Assistance",
            "Loud karaoke keeps our family awake at night.": "Noise Complaints",
            "May nagbebenta ng shabu sa aming purok.": "Drug Abuse",
            "He threatened to hurt me but did not touch or attack me.": "Threats",
            "Someone posted insulting comments about me on Facebook.": "Cyberbullying",
            "My neighbor punched me and bruised my face.": "Physical Assault",
            (
                "I would like to report a suspected drug-related activity in our community. "
                "The reported activity may pose a threat to the safety and well-being of residents. "
                "I request that the barangay authorities investigate the matter and take appropriate action."
            ): "Drug Abuse",
        }

        for description, category in examples.items():
            with self.subTest(category=category):
                result = main.classify_complaint(
                    main.ClassifyRequest(complaint_text=description)
                )
                self.assertEqual(result.predicted_category, category)

    def test_rejects_unapproved_model_output(self):
        main.model = FakeModel("Theft & Robbery")

        with self.assertRaises(HTTPException) as raised:
            main.classify_complaint(main.ClassifyRequest(complaint_text="A stolen bicycle"))

        self.assertEqual(raised.exception.status_code, 500)

    def test_rejects_empty_description(self):
        main.model = FakeModel("Safety Rules")

        with self.assertRaises(HTTPException) as raised:
            main.classify_complaint(main.ClassifyRequest(complaint_text=" "))

        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
