# Third-party / vendored Frida scripts

## native-connect-hook.js — vendored verbatim

`native-connect-hook.js` is copied **verbatim** from HTTP Toolkit's
`frida-interception-and-unpinning` project.

- **Source:** https://github.com/httptoolkit/frida-interception-and-unpinning/
- **Copyright:** Tim Perry <tim@httptoolkit.com>
- **License:** **AGPL-3.0-or-later** (`SPDX-License-Identifier: AGPL-3.0-or-later`)

### License implication for this project

Bundling and distributing this AGPL-3.0-or-later file makes the **combined,
distributed application AGPL-3.0-or-later**. Under the AGPL that means anyone you
convey the software to — including users who interact with it over a network —
must be able to obtain the corresponding source code. Keep this in mind before
shipping binaries/installers. (This was a deliberate, accepted trade-off in
exchange for using the upstream, battle-tested socket-redirection logic.)

To re-vendor / update: replace the body of `native-connect-hook.js` with the
latest upstream file (keep the SPDX header and the short adaptation note at the
top intact), then **re-apply the marked `LOCAL PATCH` block(s)**.

### Local patches (deviations from upstream verbatim)

- **`performSocksHandshake` — IPv4-mapped IPv6 unwrap.** Android apps often use
  AF_INET6 sockets with `::ffff:a.b.c.d` addresses for IPv4 destinations. Sent to
  mitmproxy's SOCKS5 server as ATYP=IPv6 these get reply 4 ("host unreachable"),
  breaking all connectivity. The patch unwraps them to ATYP=IPv4. HTTP Toolkit's
  own proxy unwraps these server-side, which is why upstream doesn't need it.

## Other scripts in this directory

`android-unpinning.js` and `android-root-bypass.js` are this project's own
implementations whose *approach* follows the same upstream project; they are
covered by this repository's license.
