/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/fair_deposit.json`.
 */
export type FairDeposit = {
  "address": "5w8Zb7EUDZNaUGo4NGBgN3scdFisZj4rDmv4qvCTrY5e",
  "metadata": {
    "name": "fairDeposit",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "Fair Deposit: a rental deposit held in escrow.",
    "",
    "Flow:",
    "1. Tenant locks the deposit (`create_deposit`). Nobody can move it alone.",
    "2. Before `refund_after`, the landlord proposes how much goes back (`propose_split`).",
    "3. Tenant accepts (`approve`) or either side escalates (`dispute`).",
    "4. A disputed deposit is split by the mediator (`resolve`).",
    "5. If the landlord never proposes, the tenant takes everything back after",
    "`refund_after` (`claim_after_timeout`).",
    "",
    "Every settlement updates the tenant's on-chain `TenantRecord`."
  ],
  "instructions": [
    {
      "name": "approve",
      "docs": [
        "Tenant accepts the landlord's proposal; funds are paid out immediately."
      ],
      "discriminator": [
        69,
        74,
        217,
        36,
        115,
        117,
        97,
        76
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "lease",
          "writable": true
        },
        {
          "name": "tenant",
          "writable": true,
          "relations": [
            "lease"
          ]
        },
        {
          "name": "landlord",
          "relations": [
            "lease"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "lease"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lease"
              }
            ]
          }
        },
        {
          "name": "tenantToken",
          "writable": true
        },
        {
          "name": "landlordToken",
          "writable": true
        },
        {
          "name": "record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "tenant"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claimAfterTimeout",
      "docs": [
        "Landlord stayed silent past the deadline: the tenant gets everything back."
      ],
      "discriminator": [
        90,
        0,
        225,
        186,
        150,
        114,
        231,
        76
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "lease",
          "writable": true
        },
        {
          "name": "tenant",
          "writable": true,
          "relations": [
            "lease"
          ]
        },
        {
          "name": "landlord",
          "relations": [
            "lease"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "lease"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lease"
              }
            ]
          }
        },
        {
          "name": "tenantToken",
          "writable": true
        },
        {
          "name": "landlordToken",
          "writable": true
        },
        {
          "name": "record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "tenant"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "createDeposit",
      "discriminator": [
        157,
        30,
        11,
        129,
        16,
        166,
        115,
        75
      ],
      "accounts": [
        {
          "name": "tenant",
          "writable": true,
          "signer": true
        },
        {
          "name": "landlord"
        },
        {
          "name": "mediator"
        },
        {
          "name": "mint"
        },
        {
          "name": "lease",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  101,
                  97,
                  115,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "tenant"
              },
              {
                "kind": "arg",
                "path": "leaseId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lease"
              }
            ]
          }
        },
        {
          "name": "tenantToken",
          "writable": true
        },
        {
          "name": "record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "tenant"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "leaseId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "refundAfter",
          "type": "i64"
        }
      ]
    },
    {
      "name": "dispute",
      "docs": [
        "Tenant or landlord escalates to the mediator."
      ],
      "discriminator": [
        216,
        92,
        128,
        146,
        202,
        85,
        135,
        73
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "lease",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "proposeSplit",
      "docs": [
        "Landlord says how much of the deposit goes back to the tenant.",
        "Can be revised until the tenant answers, but only before `refund_after`."
      ],
      "discriminator": [
        38,
        104,
        30,
        96,
        107,
        245,
        76,
        252
      ],
      "accounts": [
        {
          "name": "landlord",
          "signer": true,
          "relations": [
            "lease"
          ]
        },
        {
          "name": "lease",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "tenantAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "resolve",
      "docs": [
        "Mediator decides the split of a disputed deposit."
      ],
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "lease",
          "writable": true
        },
        {
          "name": "tenant",
          "writable": true,
          "relations": [
            "lease"
          ]
        },
        {
          "name": "landlord",
          "relations": [
            "lease"
          ]
        },
        {
          "name": "mint",
          "relations": [
            "lease"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "lease"
              }
            ]
          }
        },
        {
          "name": "tenantToken",
          "writable": true
        },
        {
          "name": "landlordToken",
          "writable": true
        },
        {
          "name": "record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  111,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "tenant"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "tenantAmount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "lease",
      "discriminator": [
        14,
        103,
        218,
        61,
        248,
        234,
        105,
        84
      ]
    },
    {
      "name": "tenantRecord",
      "discriminator": [
        133,
        41,
        49,
        113,
        244,
        169,
        161,
        125
      ]
    }
  ],
  "events": [
    {
      "name": "depositLocked",
      "discriminator": [
        32,
        241,
        131,
        66,
        63,
        132,
        192,
        116
      ]
    },
    {
      "name": "depositSettled",
      "discriminator": [
        154,
        83,
        222,
        39,
        153,
        147,
        84,
        58
      ]
    },
    {
      "name": "disputed",
      "discriminator": [
        186,
        235,
        91,
        209,
        148,
        93,
        152,
        217
      ]
    },
    {
      "name": "splitProposed",
      "discriminator": [
        79,
        18,
        65,
        165,
        147,
        244,
        179,
        235
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroAmount",
      "msg": "Deposit amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "deadlineInPast",
      "msg": "Refund deadline must be in the future"
    },
    {
      "code": 6002,
      "name": "sameParty",
      "msg": "Tenant, landlord and mediator must be different wallets"
    },
    {
      "code": 6003,
      "name": "unauthorized",
      "msg": "Only the right party can do this"
    },
    {
      "code": 6004,
      "name": "wrongStatus",
      "msg": "The deposit is not in the right state for this action"
    },
    {
      "code": 6005,
      "name": "deadlinePassed",
      "msg": "The landlord's deadline has passed"
    },
    {
      "code": 6006,
      "name": "tooEarly",
      "msg": "The refund deadline has not passed yet"
    },
    {
      "code": 6007,
      "name": "tooMuch",
      "msg": "Amount is larger than the deposit"
    },
    {
      "code": 6008,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "depositLocked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lease",
            "type": "pubkey"
          },
          {
            "name": "tenant",
            "type": "pubkey"
          },
          {
            "name": "landlord",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "refundAfter",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "depositSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lease",
            "type": "pubkey"
          },
          {
            "name": "tenantAmount",
            "type": "u64"
          },
          {
            "name": "landlordAmount",
            "type": "u64"
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "outcome"
              }
            }
          }
        ]
      }
    },
    {
      "name": "disputed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lease",
            "type": "pubkey"
          },
          {
            "name": "by",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "lease",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tenant",
            "type": "pubkey"
          },
          {
            "name": "landlord",
            "type": "pubkey"
          },
          {
            "name": "mediator",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "leaseId",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "refundAfter",
            "docs": [
              "After this time, if the landlord has not proposed a split,",
              "the tenant can take the whole deposit back."
            ],
            "type": "i64"
          },
          {
            "name": "proposedTenantAmount",
            "type": "u64"
          },
          {
            "name": "tenantReceived",
            "type": "u64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "status"
              }
            }
          },
          {
            "name": "outcome",
            "type": {
              "defined": {
                "name": "outcome"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "outcome",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "none"
          },
          {
            "name": "agreed"
          },
          {
            "name": "mediated"
          },
          {
            "name": "timedOut"
          }
        ]
      }
    },
    {
      "name": "splitProposed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lease",
            "type": "pubkey"
          },
          {
            "name": "tenantAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "status",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "proposed"
          },
          {
            "name": "disputed"
          },
          {
            "name": "settled"
          }
        ]
      }
    },
    {
      "name": "tenantRecord",
      "docs": [
        "A tenant's portable rental history, one per wallet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tenant",
            "type": "pubkey"
          },
          {
            "name": "deposits",
            "type": "u32"
          },
          {
            "name": "settled",
            "type": "u32"
          },
          {
            "name": "fullRefunds",
            "type": "u32"
          },
          {
            "name": "disputes",
            "type": "u32"
          },
          {
            "name": "totalDeposited",
            "type": "u64"
          },
          {
            "name": "totalReturned",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
