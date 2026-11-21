# Privacy Policy — Gus

_Last updated: November 2026 (Android)_

Gus is a **local-first** application: your notes and tasks never leave your computer.

## What Gus does NOT do

- No accounts, no registration, no login.
- No telemetry, no analytics, no crash reporting, no advertising, no trackers.
- Gus does not collect, transmit, sell, or share any personal data.
- Your notes (Markdown files) and tasks (local JSON store) stay on your device.

## Network requests

Gus performs network requests only to GitHub and only to keep itself up to date. None of them contains personal data, identifiers, note contents, or usage data; they consist only of standard HTTP request metadata (e.g. IP address), inherent to any web request, and nothing is stored by the application.

1. **Version check.** At startup, and when you press "Check for updates" in Settings, Gus asks GitHub whether a newer version has been published. Depending on how Gus is installed:
   - **AppImage (Linux), Windows and macOS:** it fetches the update manifest `https://github.com/victorrubilar-dev/gus/releases/latest/download/latest.json`.
   - **Linux `.deb` / `.rpm` packages:** it queries the public GitHub API (`api.github.com`) for the latest release, because those packages cannot replace themselves.
   - **Android:** the same check as `.deb` / `.rpm`. Gus never downloads anything itself; "Open release" opens the release page in your browser, where you download the new APK.

2. **Automatic download.** On the installs that can update themselves (AppImage, Windows, macOS), when a newer version exists Gus **downloads it automatically in the background**, showing a progress bar, from `https://github.com/victorrubilar-dev/gus/releases/download/`. The download is verified against a cryptographic signature using a public key embedded in the app; a file that does not match is rejected. **Nothing is installed until you press "Restart and update"**: the downloaded update stays unused until then.

3. **Manual download.** On Linux `.deb` / `.rpm` installs, Gus only offers a notice, and the installer is downloaded to your Downloads folder only when you press "Descargar", from the same GitHub releases address.

## Android storage

On Android your vault lives in a shared folder (`Documents/Gus` by default), and Gus asks for the "All files access" permission to read and write it. This is so that a sync app of your choice (Syncthing, Drive…) can reach the same folder. Gus itself never sends it anywhere.

Dictionaries for spell checking, templates, images, and all other resources are bundled with the application and loaded locally.

## Third parties

Gus communicates with no third parties. There are no external services, CDNs, or embedded SDKs.

## Changes

Any future change to this policy will be documented in this file and in the repository's release notes.

## Contact

Questions? Open an issue at https://github.com/victorrubilar-dev/gus/issues
