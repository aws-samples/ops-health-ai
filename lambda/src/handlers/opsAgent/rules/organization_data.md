## Organization Account Attributes

Key attributes of accounts in JSON format, entails account nature such as production or none production, responsible teams, and account active status.

```json
{
  "accounts": [
    {
      "id": "111111111111",
      "name": "core-repo",
      "email": "ohero+repo@example.com",
      "status": "ACTIVE",
      "tags": {
        "environment": "production",
        "team": "inf01"
      },
      "ou_names": [
        "Core"
      ]
    },
    {
      "id": "222222222222",
      "name": "sec-ops",
      "email": "ohero+secops@example.com",
      "status": "ACTIVE",
      "tags": {
        "environment": "production",
        "team": "sec01"
      },
      "ou_names": [
        "SecOps"
      ]
    },
    {
      "id": "333333333333",
      "name": "core-infrastructure",
      "email": "ohero+infra@example.com",
      "status": "ACTIVE",
      "tags": {
        "environment": "production",
        "team": "inf01"
      },
      "ou_names": [
        "Core"
      ]
    },
    {
      "id": "444444444444",
      "name": "sandpit",
      "email": "ohero+sandpit@example.com",
      "status": "ACTIVE",
      "tags": {
        "environment": "production",
        "team": "app01"
      },
      "ou_names": [
        "Sandbox"
      ]
    },
    {
      "id": "555555555555",
      "name": "Log Archive",
      "email": "ohero+logging@example.com",
      "status": "ACTIVE",
      "tags": {
        "environment": "production",
        "team": "sec01"
      },
      "ou_names": [
        "Security"
      ]
    },
    {
      "id": "666666666666",
      "name": "primary",
      "email": "ohero@example.com",
      "status": "ACTIVE",
      "tags": {
        "environment": "non-production",
        "team": "coe"
      },
      "ou_names": []
    },
    {
      "id": "777777777777",
      "name": "Audit",
      "email": "ohero+audit@example.com",
      "status": "ACTIVE",
      "tags": {
        "environment": "production",
        "team": "sec01"
      },
      "ou_names": [
        "Security"
      ]
    }
  ]
}
```

## Organizational structure and responsibilities

### Leadership Team (Team id: mgt01)
The team of senior managers who are ultimately responsible for all aspects of the company, they should be aware of all severity 5 tickets, be extra cautious about giving tickets severity 5, think carefully if the issue needs to be made aware by the company's top leadership team.

### FinOps Team (Team id: fin01)
The team of cloud finance professionals that continuously evaluate the cost status across all tenant accounts, they should be aware of all cost impacts or anomalies.

### SecOps Team (Team id: sec01)
The team of security professionals that continuously evaluate the IT security posture of the company, they should be aware of all high severity issues/situations concerning security.

### Infra Team (Team id: inf01)
Responsible for all network infrastructures, it should be the owner of the issues when affected resources involves a VPC or other networking services.

### App Team (Team id: app01)
Responsible for the operations of all resources except for networks, the team is the owner of all remediation actions against the resources and must be made aware of the issue/situation even if no action is required.
