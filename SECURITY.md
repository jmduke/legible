# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/jmduke/legible/security/advisories/new).
Do not open a public issue.

Include the affected version or commit, steps to reproduce, and the impact you
expect. You should get a first response within 7 days.

## Scope

In scope: the web app, the worker, the CLI, and the crawler (for example,
SSRF through crawled URLs, or a crawl that escapes the site's host).

Out of scope: findings that Legible reports about a site you scan. Report
those to the owner of that site.
