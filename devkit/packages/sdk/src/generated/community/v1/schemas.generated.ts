/** Generated from the canonical NAD community workflow v1 JSON Schemas. Do not edit. */
export const COMMUNITY_CONTRACT_SHA256 = '36ca202e47f5ff8d5a74bfe48191c3377d467d0f76f32f082b661dc1a3605ca6' as const;
export const communityContractLock = {
  "schemaVersion": 1,
  "contractVersion": "community-1.0",
  "sha256": "36ca202e47f5ff8d5a74bfe48191c3377d467d0f76f32f082b661dc1a3605ca6",
  "files": {
    "catalog.v1.schema.json": "09936b6cf777606597fd09d3f5516e89d2456b3bcc3307e7b674b39a8850fd74",
    "release.v1.schema.json": "44dd63a54df268867b9af5b6f6d91c2e7a6a37329aeb0a0bf2c98963d90687fe",
    "review-decision.v1.schema.json": "7ba786776dcece2e517bc5589584c40e78a030f8e38b4b606f9bbf8186665326",
    "submission.v1.schema.json": "af3a0da600a5591a90c4f8eb7a5176000b2dd3afb0e4727754074afc2a78e0e3",
    "validation-evidence.v1.schema.json": "83f845efcbb735ac8cd93d2834305f913727342e4f9afac78e8f42c8d1682823"
  }
} as const;
export const communityContractSchemas = {
  "catalog.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/community/catalog.v1.schema.json",
    "title": "NAD signed community catalogue snapshot",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "sequence",
      "issuedAt",
      "expiresAt",
      "keys",
      "releases"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "sequence": {
        "type": "integer",
        "minimum": 1,
        "maximum": 9007199254740991
      },
      "issuedAt": {
        "type": "string",
        "format": "date-time"
      },
      "expiresAt": {
        "type": "string",
        "format": "date-time"
      },
      "keys": {
        "type": "array",
        "maxItems": 200,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "purpose",
            "keyId",
            "algorithm",
            "publicKeyPem",
            "publicKeySha256",
            "status"
          ],
          "properties": {
            "purpose": {
              "enum": [
                "release",
                "review-attestation"
              ]
            },
            "keyId": {
              "type": "string",
              "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
            },
            "algorithm": {
              "const": "Ed25519"
            },
            "publicKeyPem": {
              "type": "string",
              "minLength": 80,
              "maxLength": 500
            },
            "publicKeySha256": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "status": {
              "enum": [
                "active",
                "retired",
                "revoked"
              ]
            }
          }
        }
      },
      "releases": {
        "type": "array",
        "maxItems": 5000,
        "items": {
          "$ref": "release.v1.schema.json"
        }
      }
    }
  },
  "release.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/community/release.v1.schema.json",
    "title": "NAD reviewed community release index record",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "namespace",
      "package",
      "source",
      "artifact",
      "review",
      "state",
      "publishedAt"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "namespace": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{1,39}$"
      },
      "package": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "slug",
          "name",
          "kind",
          "version",
          "license"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$"
          },
          "slug": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9-]{0,63}$"
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "kind": {
            "enum": [
              "app",
              "addon"
            ]
          },
          "version": {
            "type": "string",
            "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:[-+][0-9A-Za-z.-]+)?$"
          },
          "license": {
            "type": "string",
            "minLength": 1,
            "maxLength": 120
          }
        }
      },
      "source": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "revision",
          "directory",
          "archiveSha256"
        ],
        "properties": {
          "repositoryUrl": {
            "type": "string",
            "pattern": "^https://[^\\s]+$",
            "maxLength": 500
          },
          "revision": {
            "type": "string",
            "minLength": 7,
            "maxLength": 200
          },
          "directory": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200
          },
          "archiveSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        }
      },
      "artifact": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "url",
          "sha256",
          "bytes",
          "releaseSignerKeyId",
          "publisherCandidateSha256"
        ],
        "properties": {
          "url": {
            "type": "string",
            "pattern": "^https://[^\\s]+$",
            "maxLength": 500
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 52428800
          },
          "releaseSignerKeyId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
          },
          "publisherCandidateSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        }
      },
      "review": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "attestationUrl",
          "attestationSha256",
          "reviewerKeyId",
          "validationEvidenceSha256"
        ],
        "properties": {
          "attestationUrl": {
            "type": "string",
            "pattern": "^https://[^\\s]+$",
            "maxLength": 500
          },
          "attestationSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "reviewerKeyId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
          },
          "validationEvidenceSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        }
      },
      "state": {
        "enum": [
          "published",
          "deprecated",
          "yanked",
          "revoked"
        ]
      },
      "publishedAt": {
        "type": "string",
        "format": "date-time"
      }
    }
  },
  "review-decision.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/community/review-decision.v1.schema.json",
    "title": "NAD community review decision",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "submissionId",
      "reviewerId",
      "decision",
      "sourceSha256",
      "candidateSha256",
      "validationEvidenceSha256",
      "notes",
      "decidedAt"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "submissionId": {
        "type": "string",
        "format": "uuid"
      },
      "reviewerId": {
        "type": "string",
        "format": "uuid"
      },
      "decision": {
        "enum": [
          "changes_requested",
          "rejected",
          "approved"
        ]
      },
      "sourceSha256": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "candidateSha256": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "validationEvidenceSha256": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "notes": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4000
      },
      "decidedAt": {
        "type": "string",
        "format": "date-time"
      }
    }
  },
  "submission.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/community/submission.v1.schema.json",
    "title": "NAD community submission envelope",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "namespace",
      "source",
      "candidate",
      "publisher",
      "createdAt"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "namespace": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{1,39}$"
      },
      "source": {
        "$ref": "#/$defs/source"
      },
      "candidate": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "artifactFileName",
          "artifactSha256",
          "artifactBytes",
          "releaseRecordSha256"
        ],
        "properties": {
          "artifactFileName": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9.-]*\\.nadmod$"
          },
          "artifactSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "artifactBytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 52428800
          },
          "releaseRecordSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        }
      },
      "publisher": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "keyId",
          "publicKeySha256"
        ],
        "properties": {
          "keyId": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
          },
          "publicKeySha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        }
      },
      "createdAt": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
      }
    },
    "$defs": {
      "source": {
        "title": "NAD community source provenance",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "mode",
          "archive",
          "revision",
          "directory"
        ],
        "properties": {
          "mode": {
            "enum": [
              "archive",
              "repository"
            ]
          },
          "archive": {
            "$ref": "#/$defs/sourceArchive"
          },
          "repositoryUrl": {
            "type": "string",
            "pattern": "^https://[^\\s]+$",
            "maxLength": 500
          },
          "revision": {
            "type": "string",
            "minLength": 7,
            "maxLength": 200
          },
          "directory": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "pattern": "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$"
          }
        }
      },
      "sourceArchive": {
        "title": "NAD community source archive",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "fileName",
          "sha256",
          "bytes"
        ],
        "properties": {
          "fileName": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\\.(?:tar\\.gz|zip)$"
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 20971520
          }
        }
      }
    }
  },
  "validation-evidence.v1.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://schemas.nad.robrolabs.com/community/validation-evidence.v1.schema.json",
    "title": "NAD isolated community validation evidence",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "submissionId",
      "workerIdentity",
      "startedAt",
      "finishedAt",
      "sourceSha256",
      "candidateSha256",
      "result",
      "checks",
      "toolchain",
      "resourceUsage"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "submissionId": {
        "type": "string",
        "format": "uuid"
      },
      "workerIdentity": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$"
      },
      "startedAt": {
        "type": "string",
        "format": "date-time"
      },
      "finishedAt": {
        "type": "string",
        "format": "date-time"
      },
      "sourceSha256": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "candidateSha256": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "result": {
        "enum": [
          "passed",
          "failed"
        ]
      },
      "checks": {
        "type": "array",
        "minItems": 1,
        "maxItems": 64,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "name",
            "passed",
            "severity",
            "detail"
          ],
          "properties": {
            "name": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9-]{1,63}$"
            },
            "passed": {
              "type": "boolean"
            },
            "severity": {
              "enum": [
                "info",
                "low",
                "moderate",
                "high",
                "critical"
              ]
            },
            "detail": {
              "type": "string",
              "minLength": 1,
              "maxLength": 1000
            }
          }
        }
      },
      "toolchain": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "node",
          "workerVersion",
          "communityContractSha256"
        ],
        "properties": {
          "node": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "deno": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "workerVersion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "communityContractSha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        }
      },
      "resourceUsage": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "elapsedMs",
          "inputBytes",
          "evidenceBytes"
        ],
        "properties": {
          "elapsedMs": {
            "type": "integer",
            "minimum": 0,
            "maximum": 600000
          },
          "inputBytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 73400320
          },
          "evidenceBytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 1048576
          }
        }
      }
    }
  }
} as const;
