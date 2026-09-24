// SECURITY REGRESSION — see FINAL_PRODUCTION_AUDIT_REPORT.md, "Critical
// finding: private files reachable via unauthenticated /uploads static
// route". Confirms /uploads/private/* is rejected before express.static
// ever serves it, so private direct-chat attachments can only be fetched
// through the authenticated, membership-checked chat API.
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

const http = require("http");

let server;
let baseUrl;

beforeAll((done) => {
  const app = require("../src/app");
  server = http.createServer(app);
  server.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

describe("private upload static-serving bypass (fixed)", () => {
  test("GET /uploads/private/<conversationKey>/<filename> is rejected, unauthenticated", async () => {
    const res = await get("/uploads/private/64f000000000000000000001_64f000000000000000000002/1700000000000-file.pdf");
    expect(res.status).toBe(403);
  });

  test("a nested/traversal-style private path is also rejected", async () => {
    const res = await get("/uploads/private/anything/nested/path.txt");
    expect(res.status).toBe(403);
  });

  test("non-private static uploads (e.g. profile pictures) are unaffected", async () => {
    // Directory may not exist / file may not exist in a fresh checkout — the
    // point is only that it is NOT intercepted by the private-path 403, i.e.
    // it falls through to express.static's normal 404, not our guard.
    const res = await get("/uploads/profiles/does-not-exist.png");
    expect(res.status).not.toBe(403);
  });
});
