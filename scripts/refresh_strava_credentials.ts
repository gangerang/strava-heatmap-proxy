#!/usr/bin/env -S deno run --allow-net --allow-env
//
// Log a user into Strava and write the cookies to stdout for later use.

const STRAVA_EMAIL = Deno.env.get("STRAVA_EMAIL")!;
const STRAVA_PASSWORD = Deno.env.get("STRAVA_PASSWORD")!;

function getCookies(res: Response): Array<string> {
  const cookies = [];
  for (const [k, v] of res.headers) {
    if (k === "set-cookie") {
      const stripped = v.match(/^([^;]+);/);
      stripped !== null && cookies.push(stripped[1]);
    }
  }
  return cookies;
}

const loginFormResp = await fetch("https://www.strava.com/login", {
  method: "GET",
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
  },
});

if (!loginFormResp.ok) {
  throw new Error(`Failed to fetch login page: ${loginFormResp.status}`);
}

const loginPageText = await loginFormResp.text();
// Extract CSRF token from meta tag instead of authenticity_token input
const csrfMatch = loginPageText.match(
  /<meta name="csrf" content="([^"]+)"/
);

if (!csrfMatch) {
  throw new Error(`Could not acquire CSRF token.\n returned text\n ${loginPageText}`);
}
const csrfToken = csrfMatch[1];

// Extract cookies from the login page response
const loginCookies = getCookies(loginFormResp);

// Create form data for the login POST request
const d = new URLSearchParams();
d.set("email", STRAVA_EMAIL);
d.set("password", STRAVA_PASSWORD);
d.set("utf8", "\u2713");
d.set("plan", "");
d.set("authenticity_token", csrfToken); // Use the CSRF token here
d.set("remember_me", "on");

const sessionResp = await fetch(
  "https://www.strava.com/session",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": loginCookies.join(";"),
    },
    body: d.toString(),
    redirect: "manual",
  },
);

const sessionCookies = getCookies(sessionResp);

// This is how we grab cloudfront tokens, needed for high-res global heatmaps
const authResp = await fetch("https://heatmap-external-a.strava.com/auth", {
  headers: { "Cookie": sessionCookies.join(";") },
});

if (authResp.status !== 200) {
  throw new Error("Authentication failed.");
}

const requiredCookieNames = new Set([
  "CloudFront-Policy",
  "CloudFront-Key-Pair-Id",
  "CloudFront-Signature",
  "_strava4_session",
]);

const allCookies = getCookies(authResp).concat(sessionCookies);
const [_, stravaId] = allCookies.find((c) =>
  c.startsWith("strava_remember_id=")
)!
  .split("=", 2);

// We're limited to 1kB for CloudflareWorker Secrets, so be selective in the cookies we use
const requiredCookies = allCookies.filter((it) =>
  requiredCookieNames.has(it.split("=")[0])
);

const stravaCookies = requiredCookies.join(";");

console.log(`STRAVA_ID='${stravaId}'`);
console.log(`STRAVA_COOKIES='${stravaCookies}'`);
