/*
 * Nox Traffic Inspector — Android root-detection bypass.
 *
 * Injected into the target app alongside android-unpinning.js. Many apps refuse
 * to run (or hide traffic) on a rooted device; since the Frida path requires a
 * rooted device, this neuters the common root checks so the app behaves normally
 * while we intercept it: su-path probes, `Runtime.exec("su")`, build tags,
 * ro.debuggable/ro.secure, root-app package lookups, and RootBeer.
 *
 * Self-contained (its own Java.perform); every hook is wrapped so a missing
 * class on a given app/OS is skipped rather than aborting the script.
 */

Java.perform(function () {
    console.log('[RootBypass] Script loaded');

    var suPaths = [
        '/sbin/su', '/system/bin/su', '/system/xbin/su',
        '/system/sd/xbin/su', '/system/bin/failsafe/su',
        '/data/local/su', '/data/local/bin/su', '/data/local/xbin/su',
        '/vendor/bin/su', '/product/bin/su', '/odm/bin/su',
        '/apex/com.android.runtime/bin/su',
        '/magisk/.magisk/modules/su/bin/su',
        '/system/app/Superuser.apk'
    ];

    var rootPackages = [
        'com.topjohnwu.magisk', 'com.noshufou.android.su',
        'com.thirdparty.superuser', 'eu.chainfire.supersu',
        'com.koushikdutta.superuser', 'com.zachspong.temprootremovejb',
        'com.ramdroid.appquarantine', 'com.formyhm.hideroot'
    ];

    // File.exists — exact match
    try {
        var File = Java.use('java.io.File');
        File.exists.implementation = function () {
            var p = this.getAbsolutePath();
            for (var i = 0; i < suPaths.length; i++) {
                if (p === suPaths[i]) {
                    console.log('[RootBypass] File.exists blocked: ' + p);
                    return false;
                }
            }
            return this.exists();
        };
        console.log('[RootBypass] File.exists hooked OK');
    } catch (e) { console.log('[RootBypass] File.exists FAILED: ' + e); }

    // Runtime.exec — String overload
    try {
        var Runtime = Java.use('java.lang.Runtime');
        Runtime.exec.overload('java.lang.String').implementation = function (cmd) {
            if (cmd && (cmd === 'su' || cmd === 'which su' || cmd.indexOf('/su') !== -1)) {
                console.log('[RootBypass] Runtime.exec(String) blocked: ' + cmd);
                throw Java.use('java.io.IOException').$new('not found');
            }
            return this.exec(cmd);
        };
        // String[] overload
        Runtime.exec.overload('[Ljava.lang.String;').implementation = function (cmds) {
            if (cmds && cmds.length > 0 && cmds[0] && cmds[0].indexOf('su') !== -1) {
                console.log('[RootBypass] Runtime.exec(String[]) blocked: ' + cmds[0]);
                throw Java.use('java.io.IOException').$new('not found');
            }
            return this.exec(cmds);
        };
        console.log('[RootBypass] Runtime.exec hooked OK');
    } catch (e) { console.log('[RootBypass] Runtime.exec FAILED: ' + e); }

    // Build.TAGS — hide "test-keys"
    try {
        var Build = Java.use('android.os.Build');
        Build.TAGS.value = 'release-keys';
        console.log('[RootBypass] Build.TAGS patched to release-keys');
    } catch (e) { console.log('[RootBypass] Build.TAGS FAILED: ' + e); }

    // SystemProperties — hide ro.debuggable etc
    try {
        var SystemProperties = Java.use('android.os.SystemProperties');
        SystemProperties.get.overload('java.lang.String').implementation = function (key) {
            if (key === 'ro.debuggable' || key === 'ro.secure') {
                console.log('[RootBypass] SystemProperties.get blocked: ' + key);
                return key === 'ro.secure' ? '1' : '0';
            }
            return this.get(key);
        };
        SystemProperties.get.overload('java.lang.String', 'java.lang.String').implementation = function (key, def) {
            if (key === 'ro.debuggable' || key === 'ro.secure') {
                console.log('[RootBypass] SystemProperties.get blocked: ' + key);
                return key === 'ro.secure' ? '1' : '0';
            }
            return this.get(key, def);
        };
        console.log('[RootBypass] SystemProperties hooked OK');
    } catch (e) { console.log('[RootBypass] SystemProperties FAILED: ' + e); }

    // PackageManager — hide root-related packages
    try {
        var PackageManager = Java.use('android.app.ApplicationPackageManager');
        PackageManager.getPackageInfo.overload('java.lang.String', 'int').implementation = function (pkg, flags) {
            for (var i = 0; i < rootPackages.length; i++) {
                if (pkg === rootPackages[i]) {
                    console.log('[RootBypass] PackageManager.getPackageInfo blocked: ' + pkg);
                    throw Java.use('android.content.pm.PackageManager$NameNotFoundException').$new(pkg);
                }
            }
            return this.getPackageInfo(pkg, flags);
        };
        console.log('[RootBypass] PackageManager hooked OK');
    } catch (e) { console.log('[RootBypass] PackageManager FAILED: ' + e); }

    // RootBeer (optional)
    try {
        var RootBeer = Java.use('com.scottyab.rootbeer.RootBeer');
        RootBeer.isRooted.implementation = function () { return false; };
        console.log('[RootBypass] RootBeer hooked OK');
    } catch (e) { console.log('[RootBypass] RootBeer not present, skipping'); }

    console.log('[RootBypass] All hooks installed');
});
