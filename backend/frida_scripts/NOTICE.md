# Third-party / vendored Frida scripts

## Vendored from HTTP Toolkit's frida-interception-and-unpinning

The following files are copied from HTTP Toolkit's
`frida-interception-and-unpinning` project:

- **`native-connect-hook.js`** — verbatim (with one marked LOCAL PATCH, below).
  Redirects raw sockets to the proxy.
- **`native-tls-hook.js`** — verbatim. Trusts our CA at the **native** TLS layer
  (Android conscrypt `libssl.so`, Cronet `libsscronet.so`, iOS BoringSSL) — the
  piece our Java-only `android-unpinning.js` can't reach (Flutter, Cronet, GMS,
  connectivity checks). This is what lets natively-pinned apps work.
- **`config-helpers.js`** — the "utilities & constants" section of upstream
  `config.js` (defines `CERT_DER`, `waitForModule`, `decodeBase64`, `pemToDer`,
  module-load tracking) that `native-tls-hook.js` depends on.

For all of the above:

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

## Vendored frida-java-bridge (`frida-java-bridge.js`)

`frida-java-bridge.js` is the **compiled `frida-java-bridge` bundle**, copied
verbatim from the installed `frida-tools` package (`frida_tools/bridges/java.js`)
with only a short provenance header prepended and a one-line footer appended
(`globalThis.Java = bridge;`).

- **Why it exists:** Frida 17 removed the built-in global `Java`/`ObjC` bridges
  from the GumJS runtime. Scripts loaded via `session.create_script(<raw source>)`
  no longer have `Java` defined, so `android-unpinning.js` /
  `android-root-bypass.js` threw `'Java' is not defined`, CA trust never installed
  at the Java layer, and intercepted apps showed **"no internet"**. Prepending
  this bundle (first in the injection order) restores the global `Java`.
- **Source:** the Frida project (`frida-java-bridge`), as shipped in `frida-tools`.
- **License:** **wxWindows Library Licence, Version 3.1** (the frida-tools license).
- **Re-vendor:** when bumping the frida major version, recopy
  `frida_tools/bridges/java.js`, re-prepend the header and re-append the
  `globalThis.Java = bridge;` footer. Only the Android `Java` bridge is vendored;
  the `ObjC` bridge is not (no script references it).

## Other scripts in this directory

`android-unpinning.js` and `android-root-bypass.js` are this project's own
implementations whose *approach* follows the same upstream project; they are
covered by this repository's license.
