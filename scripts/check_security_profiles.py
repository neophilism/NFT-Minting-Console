"""Resolve a declared target architecture; never manufacture runtime evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def git(root: Path, *arguments: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *arguments], text=True).strip()


def load_json(path: Path):
    def closed_object(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError(f"Duplicate JSON key: {key}")
            obj[key] = value
        return obj
    return json.loads(path.read_text(), object_pairs_hook=closed_object)


def validate_crosswalk(upstream, source, target, configs, requirements, threats):
    for document in (requirements, threats):
        if document.get("schema_version") != "1" or document.get("scope_kind") != "target-architecture" or document.get("independent_review") != "pending":
            raise ValueError("Crosswalk and threats must retain the unreviewed target scope")
    if threats.get("implementation_verified") is not False:
        raise ValueError("Threat inventory is not implementation evidence")
    profile_refs = {ref for config in configs for ref in config["effective_profiles"]}
    allowed_states = {"unimplemented", "review-blocked", "design-resolved-only", "documented-limitation-only",
                      "external-gate", "prototype-fails", "partial-ci-only", "diagnostic-tested-only"}
    controls = set()
    for control in requirements["controls"]:
        identifier = control["id"]
        if not re.fullmatch(r"NFT-[A-Z]+-\d{3}", identifier) or identifier in controls:
            raise ValueError("Invalid or duplicate control identifier")
        controls.add(identifier)
        if control["profile_ref"] not in profile_refs:
            raise ValueError(f"Crosswalk references an unselected profile: {identifier}")
        filename = control["upstream_file"]
        if filename not in source["file_sha256"] or not filename.startswith("spec/"):
            raise ValueError(f"Crosswalk references an unlocked specification: {identifier}")
        headings = {line.lstrip("# ").strip() for line in (upstream / filename).read_text().splitlines() if line.startswith("## ")}
        if control["section"] not in headings:
            raise ValueError(f"Crosswalk section does not exist at the locked source: {identifier}")
        if control["state"] not in allowed_states:
            raise ValueError(f"Unverified control cannot claim implementation: {identifier}")
        for field in ("control", "gate", "required_evidence"):
            if not isinstance(control.get(field), str) or not control[field].strip():
                raise ValueError(f"Missing control evidence or gate: {identifier}")
    if not controls:
        raise ValueError("Requirement crosswalk must not be empty")
    flow_ids = {flow["flow_id"] for flow in target["flows"]}
    threat_ids, covered_controls = set(), set()
    for threat in threats["threats"]:
        identifier = threat["id"]
        if not re.fullmatch(r"NFT-T\d{2}", identifier) or identifier in threat_ids:
            raise ValueError("Invalid or duplicate threat identifier")
        threat_ids.add(identifier)
        if not threat.get("attacker") or not threat.get("flows") or not set(threat["flows"]) <= flow_ids:
            raise ValueError(f"Threat references missing flows: {identifier}")
        if not threat.get("required_controls") or not set(threat["required_controls"]) <= controls:
            raise ValueError(f"Threat references missing controls: {identifier}")
        covered_controls.update(threat["required_controls"])
    if covered_controls != controls:
        raise ValueError("Every crosswalk control needs an explicit threat relationship")


def check(upstream: Path, *, target=None, lock=None, requirements=None, threats=None):
    upstream = upstream.resolve()
    lock = load_json(ROOT / "security/e2eesa.lock.json") if lock is None else lock
    target = load_json(ROOT / "security/target-architecture.json") if target is None else target
    requirements = load_json(ROOT / "security/requirements.json") if requirements is None else requirements
    threats = load_json(ROOT / "security/threat-model.json") if threats is None else threats
    if lock.get("schema_version") != "1" or lock.get("scope_kind") != "target-architecture":
        raise ValueError("Lock must identify the target-architecture configuration scope")
    if lock.get("evaluation_policy") != "configuration" or lock.get("implementation_claims") != []:
        raise ValueError("PR-08 may not inject implementation or certification claims")
    if lock.get("production_certification_eligible") is not False:
        raise ValueError("Development-source configuration is not production certification")
    if lock.get("independent_review") != {"state": "pending", "evidence_ref": None}:
        raise ValueError("This configuration check cannot approve independent review; bind a separately authenticated review in a reviewed follow-up")
    source = lock["source"]
    if git(upstream, "rev-parse", "HEAD") != source["commit"] or git(upstream, "status", "--porcelain"):
        raise ValueError("E2EESA must be a clean checkout of the exact locked commit")
    for filename, expected in source["file_sha256"].items():
        if hashlib.sha256((upstream / filename).read_bytes()).hexdigest() != expected:
            raise ValueError(f"E2EESA source digest mismatch: {filename}")
    if (upstream / "VERSION").read_text().strip() != source["release_version"]:
        raise ValueError("E2EESA release version mismatch")
    sys.path.insert(0, str(upstream / "scripts"))
    import scoped_assessment
    import profile_engine
    import canonical_serialization as canonical

    basis = scoped_assessment.standard_lock(upstream)
    if basis != source["standard_lock"]:
        raise ValueError("Canonical E2EESA source tree/catalog lock mismatch")
    catalog = canonical.parse_json((upstream / "profiles/catalog.json").read_text())
    if catalog["standard_version"] != source["catalog_standard_version"]:
        raise ValueError("E2EESA catalog basis mismatch")
    if target.get("scope_kind") != "target-architecture" or target.get("schema_version") != "1":
        raise ValueError("Inventory must identify its declaration-only target scope")
    if not target.get("claim_limitations") or target.get("product_id") != "nft-console":
        raise ValueError("Product and claim limitations must be explicit")
    configs = []
    for component in target["components"]:
        configuration = {
            "schema_version": "0.1",
            "configuration_id": component["component_id"],
            "standard_version": catalog["standard_version"],
            "selected_profiles": component["profile_refs"],
            "accepted_nondefault_statuses": [],
        }
        resolution = profile_engine.resolve_configuration(catalog, configuration)
        if not resolution.valid:
            raise ValueError("; ".join(resolution.errors))
        configs.append(resolution.to_dict())
    validate_crosswalk(upstream, source, target, configs, requirements, threats)
    definition_digest = canonical.canonical_digest({"lock": lock, "target": target, "requirements": requirements, "threats": threats})
    artifact_digest = canonical.canonical_digest({"configuration_scope": "target-architecture", "resolutions": configs})
    inventory = {
        "schema_version": "0.2", "product_id": target["product_id"],
        "source_digest": definition_digest, "artifact_digest": artifact_digest,
        "components": target["components"], "flows": target["flows"], "evidence_refs": [],
    }
    request = {
        "schema_version": "0.2", "assessment_id": "nft-console-pr08-target-configuration",
        "evaluated_at": lock["evaluated_at"], "policy": "configuration", "standard_lock": basis,
        "inventory": inventory, "claims": [], "request_digest": "",
    }
    request["request_digest"] = scoped_assessment.request_digest(request)
    result = scoped_assessment.evaluate(request, root=upstream)
    if result["verdict"] != "pass" or result["result_class"] != "configuration":
        raise ValueError("; ".join(result["errors"]))
    if result["inventory_supported"] or result["production_certification_eligible"] or result["claims"]:
        raise ValueError("Declared configuration must not become runtime or certification evidence")
    return {
        "scope_kind": "target-architecture", "artifact_kind": "configuration-only",
        "standard_commit": source["commit"], "implementation_controls_verified": False,
        "independent_review": "pending", "cryptography_implementation_gate": "closed",
        "privacy_retention_design_gate": "pending-independent-review",
        "crosswalk_valid": True, "control_count": len(requirements["controls"]), "threat_count": len(threats["threats"]),
        "claim_limitations": target["claim_limitations"], "profile_resolutions": configs,
        "configuration_assessment": result,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", type=Path, default=Path(os.environ.get("E2EESA_SOURCE_DIR", ROOT / "vendor/e2eesa")))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = check(args.upstream)
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        print(json.dumps({"valid": False, "error": str(error)}, sort_keys=True))
        return 1
    if args.output:
        args.output.write_text(json.dumps(result, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"configuration_valid": True, "implementation_controls_verified": False,
                      "independent_review": "pending", "cryptography_implementation_gate": "closed",
                      "production_certification_eligible": False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
