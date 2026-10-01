# legible-cli

Crawl a website and report fixable SEO and site-health issues: broken links,
redirect chains, orphan pages, sitemap problems, meta tag issues, and more.

```sh
npx legible-cli https://example.com
npx legible-cli https://example.com --summary
npx legible-cli https://example.com --format agent > findings.md
npx legible-cli https://example.com --format json > findings.json
npx legible-cli https://example.com --format html --no-upload > report.html
```

Set `CRUX_API_KEY` to add Core Web Vitals checks from Chrome UX Report data.

See the [main repository](https://github.com/jmduke/legible) for all options,
the detector list, and the hosted pipeline that sends findings to Sentry.
