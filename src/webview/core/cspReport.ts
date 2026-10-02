// Reports CSP violations to the host log. Imported first by every notation entry point.
import { bounded, LIMITS } from '../../shared/protocol';
import { post } from './bridge';

document.addEventListener('securitypolicyviolation', (event) => {
  post({
    type: 'cspViolation',
    directive: bounded(event.effectiveDirective, LIMITS.shortText),
    blockedURI: bounded(event.blockedURI),
  });
});
