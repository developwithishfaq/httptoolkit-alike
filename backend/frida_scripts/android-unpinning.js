/*
 * Nox Traffic Inspector — Android interception + certificate unpinning.
 *
 * Injected into a single target app by FridaController. A generated prologue
 * defines NOX_CONFIG (CERT_PEM, PROXY_HOST, PROXY_PORT, DEBUG) ahead of this
 * file. Three jobs:
 *   1. Trust our CA   — add the mitmproxy CA to the app's trust evaluation so
 *                        the proxy's leaf certs validate.
 *   2. Route to proxy — set the JVM proxy properties so default HTTP clients
 *                        send through PROXY_HOST:PROXY_PORT.
 *   3. Unpin          — neuter the common certificate-pinning code paths so
 *                        apps that pin don't reject the proxy cert.
 *
 * Every hook is wrapped so a missing class on a given app/OS is skipped rather
 * than aborting the whole script. Approach follows HTTP Toolkit's MIT-licensed
 * frida-interception-and-unpinning project; the upstream scripts can be dropped
 * in here verbatim for wider coverage.
 */

"use strict";

function log(msg) {
  if (NOX_CONFIG.DEBUG) send("[nox] " + msg);
}

function safe(name, fn) {
  try {
    fn();
  } catch (e) {
    if (NOX_CONFIG.DEBUG) send("[nox] skip " + name + ": " + e);
  }
}

Java.perform(function () {
  // --- 1. Build a TrustManager that also trusts our CA -------------------
  // We parse CERT_PEM into an X509Certificate, drop it into an in-memory
  // KeyStore, and build a TrustManagerFactory from it. The resulting trust
  // managers are used to replace whatever the app installs.

  let ourTrustManagers = null;

  safe("build-trust", function () {
    const CertFactory = Java.use("java.security.cert.CertificateFactory");
    const KeyStore = Java.use("java.security.KeyStore");
    const TrustManagerFactory = Java.use("javax.net.ssl.TrustManagerFactory");
    const ByteArrayInputStream = Java.use("java.io.ByteArrayInputStream");
    const StringClass = Java.use("java.lang.String");

    const cf = CertFactory.getInstance("X.509");
    const pemBytes = StringClass.$new(NOX_CONFIG.CERT_PEM).getBytes();
    const certStream = ByteArrayInputStream.$new(pemBytes);
    const ca = cf.generateCertificate(certStream);

    const keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
    keyStore.load(null, null);
    keyStore.setCertificateEntry("nox-mitmproxy-ca", ca);

    const tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    tmf.init(keyStore);
    ourTrustManagers = tmf.getTrustManagers();
    log("CA loaded into trust store");
  });

  // --- 2. Force SSLContext.init to use our trust managers ----------------
  // Most HTTPS stacks (HttpsURLConnection, OkHttp's default, Retrofit, etc.)
  // funnel through SSLContext.init(). Replacing the trust managers there makes
  // the proxy cert validate everywhere at once.

  safe("sslcontext", function () {
    const SSLContext = Java.use("javax.net.ssl.SSLContext");
    const init = SSLContext.init.overload(
      "[Ljavax.net.ssl.KeyManager;",
      "[Ljavax.net.ssl.TrustManager;",
      "java.security.SecureRandom"
    );
    init.implementation = function (km, tm, sr) {
      log("SSLContext.init → injecting our trust managers");
      init.call(this, km, ourTrustManagers || tm, sr);
    };
  });

  // --- 3. Neuter the common pinning implementations ----------------------

  // 3a. Android's hidden TrustManagerImpl.verifyChain / checkTrustedRecursive —
  // the lowest-level check most pinning ultimately reaches. Return the chain
  // unmodified so it's accepted.
  safe("TrustManagerImpl", function () {
    const TrustManagerImpl = Java.use("com.android.org.conscrypt.TrustManagerImpl");
    TrustManagerImpl.checkTrustedRecursive.implementation = function (
      certs, ocspData, tlsSctData, host, clientAuth, untrustedChain, trustAnchors, used
    ) {
      log("TrustManagerImpl.checkTrustedRecursive bypassed for " + host);
      return Java.use("java.util.ArrayList").$new();
    };
  });

  // 3b. OkHttp3 CertificatePinner.check(...) — make every overload a no-op.
  safe("okhttp3", function () {
    const CertificatePinner = Java.use("okhttp3.CertificatePinner");
    CertificatePinner.check.overloads.forEach(function (overload) {
      overload.implementation = function () {
        log("okhttp3 CertificatePinner.check bypassed");
        return;
      };
    });
  });

  // 3c. Legacy embedded okhttp (com.android.okhttp / com.squareup.okhttp).
  ["com.android.okhttp.CertificatePinner", "com.squareup.okhttp.CertificatePinner"].forEach(
    function (klass) {
      safe(klass, function () {
        const CP = Java.use(klass);
        CP.check.overloads.forEach(function (overload) {
          overload.implementation = function () {
            log(klass + ".check bypassed");
            return;
          };
        });
      });
    }
  );

  // 3d. TrustManagerImpl.verifyChain (newer signature returning the chain).
  safe("verifyChain", function () {
    const TrustManagerImpl = Java.use("com.android.org.conscrypt.TrustManagerImpl");
    TrustManagerImpl.verifyChain.implementation = function (
      untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData
    ) {
      log("TrustManagerImpl.verifyChain bypassed for " + host);
      return untrustedChain;
    };
  });

  // 3e. HostnameVerifier — accept the proxy hostname mismatch.
  safe("hostnameVerifier", function () {
    const OkHostnameVerifier = Java.use("okhttp3.internal.tls.OkHostnameVerifier");
    OkHostnameVerifier.verify.overload("java.lang.String", "javax.net.ssl.SSLSession")
      .implementation = function () {
        return true;
      };
  });

  // --- 4. Route default HTTP clients through our proxy -------------------
  // Many apps respect the JVM proxy system properties; setting them here pushes
  // their traffic to mitmproxy even when no device-wide proxy is set.

  safe("proxy-props", function () {
    const System = Java.use("java.lang.System");
    System.setProperty("http.proxyHost", NOX_CONFIG.PROXY_HOST);
    System.setProperty("http.proxyPort", "" + NOX_CONFIG.PROXY_PORT);
    System.setProperty("https.proxyHost", NOX_CONFIG.PROXY_HOST);
    System.setProperty("https.proxyPort", "" + NOX_CONFIG.PROXY_PORT);
    log("JVM proxy → " + NOX_CONFIG.PROXY_HOST + ":" + NOX_CONFIG.PROXY_PORT);
  });

  log("interception hooks installed");
});
