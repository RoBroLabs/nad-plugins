# Proxmox schema-v2 reference App

This source-only reference keeps the published schema-v1 Proxmox releases unchanged while proving the Phase 6 App boundary. Core owns unlimited named connection profiles and injects credentials only inside the declared HTTP scopes. `guests` and `guest-action` are versioned operations that an approved Add-on can consume without seeing profile values.
