const {
  searchLearning,
  checkRateLimit,
  sanitizeText,
  extractDomain,
} = require("../src/services/learningSearchService");

describe("LearningSearch Service Tests", () => {
  beforeEach(() => {
    delete process.env.LEARNING_SEARCH_PROVIDER;
    delete process.env.TAVILY_API_KEY;
  });

  describe("Input Validation", () => {
    it("rejects empty query", async () => {
      const res = await searchLearning({ query: "", userId: "user123" });
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(400);
      expect(res.message).toMatch(/Search query is required/i);
    });

    it("rejects queries shorter than 2 characters", async () => {
      const res = await searchLearning({ query: "a", userId: "user123" });
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(400);
      expect(res.message).toMatch(/at least 2 characters/i);
    });

    it("rejects queries exceeding 300 characters", async () => {
      const longQuery = "a".repeat(301);
      const res = await searchLearning({ query: longQuery, userId: "user123" });
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(400);
      expect(res.message).toMatch(/cannot exceed 300 characters/i);
    });
  });

  describe("Sanitization and Domain Extraction", () => {
    it("strips HTML tags and excessive whitespace", () => {
      const dirty = "<script>alert(1)</script> Hello   <b>world</b>! ";
      expect(sanitizeText(dirty)).toBe("alert(1) Hello world!");
    });

    it("extracts clean domain from standard URLs", () => {
      expect(extractDomain("https://en.wikipedia.org/wiki/React_(software)")).toBe("en.wikipedia.org");
      expect(extractDomain("http://www.developer.mozilla.org/en-US/docs/Web")).toBe("developer.mozilla.org");
    });

    it("rejects invalid or unsafe URL schemes", () => {
      expect(extractDomain("javascript:alert(1)")).toBe("");
      expect(extractDomain("data:text/html;base64,...")).toBe("");
      expect(extractDomain("not-a-url")).toBe("");
    });
  });

  describe("Rate Limiting", () => {
    it("allows standard requests within threshold and blocks beyond 30 requests per minute", () => {
      const testUserId = "rate_limit_test_user_" + Date.now();
      for (let i = 0; i < 30; i++) {
        expect(checkRateLimit(testUserId)).toBe(true);
      }
      // 31st request must fail rate limit
      expect(checkRateLimit(testUserId)).toBe(false);
    });
  });

  describe("Provider Configuration & Fallback", () => {
    it("returns safe disabled response when LEARNING_SEARCH_PROVIDER is disabled", async () => {
      process.env.LEARNING_SEARCH_PROVIDER = "disabled";
      const res = await searchLearning({ query: "explain recursion", userId: "user456" });
      expect(res.success).toBe(true);
      expect(res.data.configured).toBe(false);
      expect(res.data.results).toEqual([]);
      expect(res.data.message).toMatch(/disabled/i);
    });

    it("handles mock/test queries safely without throwing unhandled exceptions", async () => {
      const res = await searchLearning({ query: "What is binary search?", userId: "user789" });
      expect(res.success).toBe(true);
      expect(res.data.query).toBe("What is binary search?");
      expect(Array.isArray(res.data.results)).toBe(true);
    }, 15000);
  });
});
