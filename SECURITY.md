# Security

## Reporting

Use [private vulnerability reporting](https://github.com/nishachay/outtake/security/advisories/new).
Do not open a public issue.

Include what you found, how to reproduce it, and the impact. Response within 48
hours.

## Takedown requests

Rights holders: every track has a report action in the app that hides it
immediately. That is the fastest route and needs no email.

Valid notices are honoured by hiding content first and discussing afterwards. Three
verified complaints auto-hide a track pending review.

This project hosts no media. It stores YouTube video ids and links to public
uploads.

## Notes for security review

- One API surface: `app/api/[...path]/route.ts`, logic in `lib/api-core.ts`. Admin
  routes require `Authorization: Bearer $ADMIN_KEY` or a GitHub session listed in
  `ADMIN_GITHUB_LOGINS`.
- Auth is `next-auth@5.0.0-beta.32`, a beta release, used for admin sign-in only.
  It carried CVE-2026-73419 (CVSS 6.8); the pinned version includes the fix.
- Rate limiting is per-instance, so concurrent function instances each keep their
  own window. It deters casual spam, not a determined attacker.
- `POST /api/submit` accepts untrusted input. It is length-capped,
  honeypot-guarded, and rejects duplicate open submissions per video.
- No secret is committed. If you find one, report it privately and rotate it.
