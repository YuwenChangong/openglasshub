# P11 migration-history registration preparation

P10 materialization was proved by the receipt; the sole remaining blocker is the absent `20260902042807` history row. The installed Supabase CLI is `2.115.0` and its offline help confirms `migration repair --status applied --linked`.

The P11 guard permits only `20260902042807`, status `applied`, project `xcbnxzjlsvtgzixurcof`, frozen P10 migration SHA-256 `2F98FEA88B4B5619DCE82A0E48C0653C96F4DB3E212D6F52A85FBAB083405E65`, a clean approved source, and a process-local `SUPABASE_DB_PASSWORD`. Its future argv contains no credential and is exactly `migration repair 20260902042807 --status applied --linked`.

This preparation does not execute the repair. A missing local linked-project record is fail-closed: future authorization must supply an exact verified link before any CLI spawn. The prospective production mutation is migration-history metadata only: one history mutation, zero schema mutations, and zero application-data mutations.

Local CLI proof used an isolated temporary runtime with the canonical target row absent, then ran `migration repair 20260902042807 --status applied --local`: history became present while the devices receipt remained canonical. A separate temporary `20991231235959_p11_replay_sentinel.sql` contained a deterministic exception; its real local repair succeeded, registered history, and did not execute the exception body. The sentinel was never added to repository migrations. The already-present wrapper guard rejects before subprocess spawn and preserves the one-row history fingerprint.
