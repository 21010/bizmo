// Loaded first (own nonce'd script) so CSP violations during bundle evaluation are captured too.
window.__violations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  window.__violations.push({
    directive: event.effectiveDirective,
    blockedURI: event.blockedURI,
    sample: event.sample,
    source: event.sourceFile,
    line: event.lineNumber,
    column: event.columnNumber,
  });
});
