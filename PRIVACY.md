# Privacy Policy — Gus

_Last updated: October 2026_

Gus is a **local-first** application: your notes and tasks never leave your computer.

## What Gus does NOT do

- No accounts, no registration, no login.
- No telemetry, no analytics, no crash reporting, no advertising, no trackers.
- Gus does not collect, transmit, sell, or share any personal data.
- Your notes (Markdown files) and tasks (local JSON store) stay on your device.

## Network requests

Gus performs two kinds of network request, both only to GitHub and both only to update checks:

1. **Version check.** A request to the public GitHub API to detect whether a newer version has been published, shown as an update notice. This request:
   - contains no personal data, identifiers, note contents, or usage data,
   - consists only of standard HTTP request metadata (e.g. IP address), inherent to any web request,
   - is never stored by the application.

2. **Installer download.** Only when you press "Descargar" in the update notice, Gus downloads the installer of that release from the project's GitHub releases and saves it to your Downloads folder. It only downloads from `https://github.com/victorrubilar-dev/gus/releases/download/`, and it sends no data beyond the standard HTTP request. Nothing is downloaded without your action.

Dictionaries for spell checking, templates, images, and all other resources are bundled with the application and loaded locally.

## Third parties

Gus communicates with no third parties. There are no external services, CDNs, or embedded SDKs.

## Changes

Any future change to this policy will be documented in this file and in the repository's release notes.

## Contact

Questions? Open an issue at https://github.com/victorrubilar-dev/gus/issues
