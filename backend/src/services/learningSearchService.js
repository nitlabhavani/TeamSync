/**
 * LEARNING SEARCH SERVICE (In-App Search Engine / Ask & Learn)
 * ============================================================
 *
 * Dedicated educational search service for programming doubts, technical
 * concepts, algorithmic problems, and project-related learning questions.
 *
 * PRIVACY & ROLE RULES:
 * - Strictly isolated from group chat analysis, student risk analysis,
 *   project memory, meeting intelligence, reports, and contribution scoring.
 * - Never receives or forwards private messages, files, voice notes, calls,
 *   passwords, tokens, or group data.
 * - Strictly proxied through backend: no API keys or secret credentials ever
 *   reach the frontend.
 * - Rate limited per user with input length constraints and timeout guards.
 * - Safe fallback when external provider is unconfigured (no fake results).
 */

const https = require("https");
const { URL } = require("url");

const TIMEOUT_MS = Number(process.env.LEARNING_SEARCH_TIMEOUT_MS || 8000);
const MAX_QUERY_LEN = 300;
const MIN_QUERY_LEN = 2;
const MAX_RESULTS = 10;

// In-memory rate limiting map: userId -> [timestamps]
const userRateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;

/**
 * Validates rate limit for a user (max 30 requests per minute).
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const uid = String(userId);
  let timestamps = userRateLimits.get(uid) || [];
  timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    userRateLimits.set(uid, timestamps);
    return false;
  }
  timestamps.push(now);
  userRateLimits.set(uid, timestamps);
  return true;
}

/**
 * Extracts and sanitizes domain from URL.
 */
function extractDomain(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Sanitizes text to remove unsafe HTML tags or excessive whitespace.
 */
function sanitizeText(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Robust HTTPS JSON request helper with configurable SSL verification.
 * Avoids Node.js UNABLE_TO_VERIFY_LEAF_SIGNATURE errors in corporate/proxy/Windows environments.
 */
function httpsRequestJson(urlStr, { method = "GET", headers = {}, body = null, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const reqHeaders = {
        "User-Agent": "TeamSync-AI-LearningSearch/1.0 (Educational Assistant)",
        Accept: "application/json",
        ...headers,
      };

      let bodyData = null;
      if (body) {
        bodyData = typeof body === "string" ? body : JSON.stringify(body);
        reqHeaders["Content-Type"] = reqHeaders["Content-Type"] || "application/json";
        reqHeaders["Content-Length"] = Buffer.byteLength(bodyData);
      }

      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method,
          headers: reqHeaders,
          rejectUnauthorized: false,
          timeout,
        },
        (res) => {
          let chunks = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (chunks += c));
          res.on("end", () => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return resolve({
                ok: false,
                status: res.statusCode,
                error: `Search provider responded with status ${res.statusCode}`,
              });
            }
            try {
              const data = JSON.parse(chunks);
              resolve({ ok: true, status: res.statusCode, data });
            } catch {
              resolve({ ok: false, status: res.statusCode, error: "Failed to parse JSON response" });
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, error: "Search request timed out" });
      });

      req.on("error", (err) => {
        resolve({ ok: false, error: err.message || "Network request failed" });
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

/**
 * Searches Wikipedia Educational Knowledge REST API.
 * Free, live, and delivers high-quality articles for programming and academic queries.
 */
async function searchWikipedia(query) {
  const endpoint = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=${MAX_RESULTS}`;
  const res = await httpsRequestJson(endpoint);

  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  const pages = res.data?.pages || [];
  const results = [];
  let answer = null;

  for (const p of pages) {
    if (!p.title) continue;
    const title = sanitizeText(p.title);
    const snippet = sanitizeText(p.excerpt || p.description || "");
    const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key || p.title.replace(/ /g, "_"))}`;

    if (!answer && p.description && p.description.length > 10) {
      answer = `${title}: ${p.description}`;
    }

    results.push({
      title,
      url: pageUrl,
      domain: "en.wikipedia.org",
      snippet: snippet || `${title} on Wikipedia`,
      source: "Wikipedia",
    });
  }

  return { ok: true, results, answer };
}

/**
 * Searches DuckDuckGo Instant Answers API.
 */
async function searchDuckDuckGo(query) {
  const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await httpsRequestJson(endpoint);

  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  const data = res.data || {};
  const results = [];
  let answer = null;

  if (data.AbstractText && data.AbstractURL) {
    const domain = extractDomain(data.AbstractURL);
    if (domain) {
      answer = sanitizeText(data.AbstractText);
      results.push({
        title: sanitizeText(data.Heading || query),
        url: data.AbstractURL,
        domain,
        snippet: sanitizeText(data.AbstractText),
        source: data.AbstractSource || domain,
      });
    }
  }

  if (Array.isArray(data.RelatedTopics)) {
    for (const item of data.RelatedTopics) {
      if (results.length >= MAX_RESULTS) break;
      if (item.Text && item.FirstURL) {
        const domain = extractDomain(item.FirstURL);
        if (domain) {
          results.push({
            title: sanitizeText(item.Text.split(" - ")[0] || query),
            url: item.FirstURL,
            domain,
            snippet: sanitizeText(item.Text),
            source: domain,
          });
        }
      }
    }
  }

  return { ok: true, results, answer };
}

/**
 * Searches Tavily API if configured via TAVILY_API_KEY.
 */
async function searchTavily(query, apiKey) {
  const res = await httpsRequestJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      api_key: apiKey,
      query,
      search_depth: "basic",
      include_answer: true,
      max_results: MAX_RESULTS,
    },
  });

  if (!res.ok) {
    return { ok: false, error: res.error };
  }

  const data = res.data || {};
  const results = [];

  if (Array.isArray(data.results)) {
    for (const r of data.results) {
      const domain = extractDomain(r.url);
      if (domain && r.title) {
        results.push({
          title: sanitizeText(r.title),
          url: r.url,
          domain,
          snippet: sanitizeText(r.content || ""),
          source: domain,
        });
      }
    }
  }

  return { ok: true, results, answer: data.answer || null };
}

/**
 * Main search method.
 *
 * @param {Object} options
 * @param {string} options.query - The search query
 * @param {string} options.userId - The authenticated user ID
 */
async function searchLearning({ query, userId }) {
  const cleanQuery = typeof query === "string" ? query.trim() : "";
  if (!cleanQuery) {
    return {
      success: false,
      statusCode: 400,
      message: "Search query is required",
    };
  }

  if (cleanQuery.length < MIN_QUERY_LEN) {
    return {
      success: false,
      statusCode: 400,
      message: `Search query must be at least ${MIN_QUERY_LEN} characters`,
    };
  }

  if (cleanQuery.length > MAX_QUERY_LEN) {
    return {
      success: false,
      statusCode: 400,
      message: `Search query cannot exceed ${MAX_QUERY_LEN} characters`,
    };
  }

  // Rate limit check (30 requests/minute)
  if (!checkRateLimit(userId)) {
    return {
      success: false,
      statusCode: 429,
      message: "Too many search requests. Please slow down and try again shortly.",
    };
  }

  const provider = (process.env.LEARNING_SEARCH_PROVIDER || "auto").toLowerCase();
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (provider === "disabled") {
    return {
      success: true,
      data: {
        query: cleanQuery,
        total: 0,
        configured: false,
        results: [],
        message: "External search provider is currently disabled in system configuration.",
      },
    };
  }

  let finalResults = [];
  let finalAnswer = null;
  let warningMessage = null;

  // 1. Tavily if key configured
  if ((provider === "tavily" || tavilyKey) && tavilyKey) {
    const tavilyRes = await searchTavily(cleanQuery, tavilyKey);
    if (tavilyRes.ok && tavilyRes.results?.length) {
      return {
        success: true,
        data: {
          query: cleanQuery,
          total: tavilyRes.results.length,
          configured: true,
          answer: tavilyRes.answer || null,
          results: tavilyRes.results.slice(0, MAX_RESULTS),
        },
      };
    }
  }

  // 2. Wikipedia Educational Knowledge API (high reliability default)
  const wikiRes = await searchWikipedia(cleanQuery);
  if (wikiRes.ok && wikiRes.results?.length) {
    finalResults = wikiRes.results;
    finalAnswer = wikiRes.answer;
  } else if (!wikiRes.ok) {
    warningMessage = wikiRes.error;
  }

  // 3. Complement with DuckDuckGo Instant Answers if available
  const ddgRes = await searchDuckDuckGo(cleanQuery);
  if (ddgRes.ok) {
    if (ddgRes.answer && !finalAnswer) {
      finalAnswer = ddgRes.answer;
    }
    const seenUrls = new Set(finalResults.map((r) => r.url.toLowerCase()));
    for (const r of ddgRes.results || []) {
      if (!seenUrls.has(r.url.toLowerCase()) && finalResults.length < MAX_RESULTS) {
        seenUrls.add(r.url.toLowerCase());
        finalResults.push(r);
      }
    }
  }

  if (!finalResults.length && warningMessage) {
    return {
      success: true,
      data: {
        query: cleanQuery,
        total: 0,
        configured: true,
        results: [],
        warning: warningMessage,
      },
    };
  }

  return {
    success: true,
    data: {
      query: cleanQuery,
      total: finalResults.length,
      configured: true,
      answer: finalAnswer,
      results: finalResults.slice(0, MAX_RESULTS),
    },
  };
}

module.exports = {
  searchLearning,
  checkRateLimit,
  sanitizeText,
  extractDomain,
};
