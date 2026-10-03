# Security policy

Bizmo opens model files from any repository, including untrusted ones, so security issues matter
to us: for example, a model file or element template that runs script in an editor, reaches the
network, reads or writes files it should not, or crashes or freezes VS Code.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: on the
[Security tab](https://github.com/21010/bizmo/security) choose **Report a vulnerability**. Do not
open a public issue.

Include the Bizmo and VS Code versions, the steps or a sample file that shows the problem, and its
impact as you see it. We will acknowledge the report within a week and keep you informed about the
fix.

## Supported versions

Fixes are released for the latest version only. Install it from the
[releases page](https://github.com/21010/bizmo/releases).

## Design

The security design is described in the README ("Security") and the architecture decisions in
`docs/adr/` (in particular ADR 0008 on the webview Content Security Policy).
