import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_security_profiles as checker


class ProfileScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.upstream = Path(os.environ.get("E2EESA_SOURCE_DIR", ROOT / "vendor/e2eesa"))
        cls.target = checker.load_json(ROOT / "security/target-architecture.json")
        cls.lock = checker.load_json(ROOT / "security/e2eesa.lock.json")
        cls.requirements = checker.load_json(ROOT / "security/requirements.json")
        cls.threats = checker.load_json(ROOT / "security/threat-model.json")

    def test_owner_policy_allows_crypto_work_without_claiming_certification(self):
        result = checker.check(self.upstream)
        self.assertFalse(result["implementation_controls_verified"])
        self.assertEqual(result["cryptography_implementation_gate"], "open-with-ai-review")
        self.assertEqual(result["independent_review"], "pending")
        self.assertEqual(result["privacy_retention_design_gate"], "ai-review-required")
        assessment = result["configuration_assessment"]
        self.assertFalse(assessment["inventory_supported"])
        self.assertFalse(assessment["production_certification_eligible"])
        self.assertEqual(assessment["claims"], [])

    def test_unknown_or_floating_profile_is_rejected(self):
        for ref in ["attachment-chunked-aead@latest", "invented-profile@0.1.0"]:
            target = copy.deepcopy(self.target)
            target["components"][0]["profile_refs"][0] = ref
            with self.assertRaises(ValueError): checker.check(self.upstream, target=target)

    def test_attachment_requires_parent_channel_in_that_flow(self):
        target = copy.deepcopy(self.target)
        target["flows"][0]["profile_refs"].remove("group-mls-rfc9420@0.1.0")
        with self.assertRaisesRegex(ValueError, "DEP-AUTHENTICATED-PARENT-CHANNEL"):
            checker.check(self.upstream, target=target)

    def test_endpoint_cannot_omit_local_secret_storage(self):
        target = copy.deepcopy(self.target)
        for record in target["components"][:1] + [f for f in target["flows"] if f["component_id"] == "browser"]:
            if "secret-software-vault@0.1.0" in record["profile_refs"]:
                record["profile_refs"].remove("secret-software-vault@0.1.0")
        with self.assertRaisesRegex(ValueError, "DEP-CONTENT-AUTHORITY"):
            checker.check(self.upstream, target=target)

    def test_claim_or_self_approved_review_cannot_be_injected(self):
        for field, value in [("implementation_claims", ["encrypted"]),
                             ("production_certification_eligible", True),
                             ("independent_review", {"state": "approved", "evidence_ref": "self-claim"})]:
            lock = copy.deepcopy(self.lock)
            lock[field] = value
            with self.assertRaises(ValueError): checker.check(self.upstream, lock=lock)

    def test_changed_commit_or_file_digest_is_rejected(self):
        lock = copy.deepcopy(self.lock)
        lock["source"]["commit"] = "1" * 40
        with self.assertRaisesRegex(ValueError, "exact locked commit"):
            checker.check(self.upstream, lock=lock)
        lock = copy.deepcopy(self.lock)
        lock["source"]["file_sha256"]["profiles/catalog.json"] = "1" * 64
        with self.assertRaisesRegex(ValueError, "source digest mismatch"):
            checker.check(self.upstream, lock=lock)

    def test_duplicate_json_keys_are_invalid(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture = Path(folder) / "bad.json"
            fixture.write_text('{"scope_kind":"target-architecture","scope_kind":"production"}')
            with self.assertRaisesRegex(ValueError, "Duplicate JSON key"):
                checker.load_json(fixture)

    def test_crosswalk_rejects_unknown_source_section_profile_and_evidence_claim(self):
        for field, value in [("section", "99. Invented section"), ("upstream_file", "spec/unlocked.md"),
                             ("profile_ref", "secret-hardware-isolated@0.1.0"), ("state", "verified")]:
            requirements = copy.deepcopy(self.requirements)
            requirements["controls"][0][field] = value
            with self.assertRaises(ValueError): checker.check(self.upstream, requirements=requirements)

    def test_threats_cannot_reference_missing_flows_or_controls(self):
        for field, value in [("flows", ["missing-flow"]), ("required_controls", ["NFT-FAKE-999"])]:
            threats = copy.deepcopy(self.threats)
            threats["threats"][0][field] = value
            with self.assertRaises(ValueError): checker.check(self.upstream, threats=threats)

    def test_duplicate_control_and_uncovered_control_are_rejected(self):
        requirements = copy.deepcopy(self.requirements)
        requirements["controls"].append(copy.deepcopy(requirements["controls"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate control"):
            checker.check(self.upstream, requirements=requirements)
        threats = copy.deepcopy(self.threats)
        for threat in threats["threats"]:
            threat["required_controls"] = [ref for ref in threat["required_controls"] if ref != "NFT-FILE-003"]
        with self.assertRaisesRegex(ValueError, "Every crosswalk control"):
            checker.check(self.upstream, threats=threats)


if __name__ == "__main__":
    unittest.main()
