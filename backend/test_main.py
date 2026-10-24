import io
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from backend import main


class EvidenceDeskTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        main.DATA_DIR = Path(self.temp.name) / "data"
        main.UPLOAD_DIR = Path(self.temp.name) / "uploads"
        main.DB_PATH = main.DATA_DIR / "test.sqlite3"
        main.init_db()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def investigate(self, sources=(), file=None, filename=None):
        payload = {"claim": "The university has cancelled all examinations this week", "message": "Forwarded message", "source_urls": __import__("json").dumps(list(sources))}
        files = {"file": (filename, file, "application/octet-stream")} if file is not None else None
        return self.client.post("/api/investigations", data=payload, files=files)

    def test_synthetic_official_fixture_supports_claim(self):
        result = self.investigate([next(iter(main.SOURCES))]).json()
        self.assertEqual(result["assessment"], "Supported")
        self.assertTrue(result["sources"][0]["synthetic"])
        self.assertTrue(result["sources"][0]["evidence_excerpt"])

    def test_current_announcement_contradicts_claim(self):
        url = list(main.SOURCES)[1]
        result = self.investigate([url]).json()
        self.assertEqual(result["assessment"], "Contradicted")
        self.assertEqual(result["sources"][0]["relation"], "contradicts")

    def test_no_source_is_inconclusive_and_record_persists(self):
        response = self.investigate()
        self.assertEqual(response.json()["assessment"], "Inconclusive")
        records = self.client.get("/api/investigations").json()
        self.assertEqual(len(records), 1)
        report = self.client.get(f"/api/investigations/{response.json()['id']}").json()
        self.assertEqual(report["claim"], "The university has cancelled all examinations this week")

    def test_image_without_exif_metadata_is_not_called_manipulated(self):
        output = io.BytesIO()
        Image.new("RGB", (80, 40), "white").save(output, format="PNG")
        result = self.investigate(file=output.getvalue(), filename="notice.png").json()
        self.assertEqual(result["assessment"], "Inconclusive")
        self.assertEqual(result["file"]["metadata"]["exif"], "Not available")
        self.assertIn("not evidence of manipulation", result["file"]["indicators"][0]["explanation"])

    def test_unsupported_and_corrupt_files_are_rejected_clearly(self):
        unsupported = self.investigate(file=b"data", filename="payload.exe")
        self.assertEqual(unsupported.status_code, 415)
        corrupt = self.investigate(file=b"not an image", filename="notice.png")
        self.assertEqual(corrupt.status_code, 422)
        self.assertIn("unreadable or corrupted", corrupt.json()["detail"])

    def test_unapproved_source_fetch_fails_without_inventing_evidence(self):
        response = self.investigate(["https://unknown.invalid/fake-announcement"])
        report = response.json()
        self.assertEqual(report["assessment"], "Inconclusive")
        self.assertEqual(report["sources"][0]["relation"], "unavailable")
        self.assertEqual(report["sources"][0]["evidence_excerpt"], "")


if __name__ == "__main__":
    unittest.main()
