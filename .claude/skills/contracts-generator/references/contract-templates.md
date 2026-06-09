# Contract Templates Reference

This file documents the exact format for each of the ten contract items.
Load this when generating a specific contract item for precise field names and structure.

## Quick Format Reference

| Item | File | Format | Machine-readable? |
|------|------|--------|-------------------|
| API Contract | api-contract.yaml | OpenAPI 3.0 subset | Yes |
| Auth Matrix | auth-matrix.json | JSON object | Yes |
| State Machines | state-machines.md | Markdown tables | No |
| Integration Map | integration-map.md | Markdown sections | No |
| Error Taxonomy | error-taxonomy.md | Markdown table | No |
| Testing Contract | testing-contract.md | Markdown tables | No |
| Environment Contract | environment-contract.md | Markdown tables | No |
| Shared Utilities | shared-utilities.md | Markdown tables | No |
| Dependency Register | dependency-register.md | Markdown tables | No |
| NFR Thresholds | nfr-thresholds.md | Markdown tables | No |

## api-contract.yaml Required Fields Per Endpoint

```yaml
paths:
  /api/v1/{resource}:
    {method}:
      summary: string          # short description
      operationId: string      # camelCase unique identifier
      tags: [string]           # resource category
      security: []             # [] = public, [{bearerAuth:[]}] = protected
      parameters: []           # query/path params with schema
      requestBody:             # POST/PUT/PATCH only
        required: boolean
        content:
          application/json:
            schema: {}
      responses:
        "200":                 # success response with schema
        "401":                 # if protected
        "403":                 # if role-restricted
        "422":                 # if has request body
```

## auth-matrix.json Required Structure

```json
{
  "_meta": {
    "roles": [],        // all role names from BRD
    "resources": [],    // all resource names from data model
    "operations": ["create","read_own","read_all","update_own","update_all","delete"]
  },
  "matrix": {
    "{role}": {
      "{resource}": {
        "create": bool,
        "read_own": bool,
        "read_all": bool,
        "update_own": bool,
        "update_all": bool,
        "delete": bool
      }
    }
  },
  "public_endpoints": [],        // paths with no auth required
  "service_to_service_only": [],  // paths requiring API key, no user session
  "http_status_rules": {
    "unauthenticated": 401,
    "unauthorised": 403
  }
}
```

## state-machines.md Required Structure Per Entity

```markdown
## {EntityName} — `{entity}_status` enum

### States
| State | Description |

### Valid Transitions  
| From | To | Trigger | Who Can Trigger | Side Effects |

### Invalid Transitions (return 409 CONFLICT)
- {from} → {to} — reason

### Compensating Actions on Failure
- If {step} fails: {action}
```

## error-taxonomy.md Required Columns

| Code | HTTP Status | Meaning | User-Visible? | Triggers Alert? | Example |

Minimum required codes:
- VALIDATION_ERROR (422)
- NOT_FOUND (404)  
- UNAUTHORISED (403)
- AUTH_REQUIRED (401)
- CONFLICT (409)
- RATE_LIMITED (429)
- EXTERNAL_SERVICE_ERROR (502)
- INTERNAL_ERROR (500)
