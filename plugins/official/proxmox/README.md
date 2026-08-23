# Proxmox VE Module

This official NAD Module reads bounded Proxmox VE node, QEMU/LXC guest,
storage, and recent-task data through the NAD Host API. The package has no
direct network, filesystem, environment, or subprocess access.

Configure an HTTPS Proxmox root URL, a token identity in
`user@realm!token-name` form, its secret, and the TLS verification choice.
NAD core combines the public token identity and encrypted secret into the
`Authorization: PVEAPIToken=<id>=<secret>` header. Module code receives only an
opaque secret-presence reference and never constructs or reads the header.

The `guest-action` mutation accepts only `start`, `stop`, or `restart` for a
validated node, `qemu`/`lxc` type, and VMID. It records the returned UPID,
re-reads recent task and guest state, and returns a confirmed, failed, or
recoverable indeterminate outcome. Every upstream attempt is annotated with
bounded non-secret audit metadata.

The stable `console` permission is reserved but no console endpoint ships in
1.0.2. A functional console requires a short-lived origin-bound ticket broker,
an authenticated WebSocket proxy, and a dedicated reviewed UI; returning a VNC
ticket in declarative data would be unsafe and incomplete.

For action validation, use only a named disposable guest and record its initial
and final state. Never exercise mutations against an unspecified or protected
guest.
