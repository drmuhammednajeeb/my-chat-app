import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in index.html");
  let depth = 0, opened = false, quote = null, escaped = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") { depth++; opened = true; }
    else if (ch === "}" && opened && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unclosed function: " + name);
}

const functionNames = [
  "normalizeDirectoryDigits",
  "normalizeDirectorySearch",
  "directoryMembershipDigits",
  "buildDirectoryQuery",
  "loadDirectory"
];
const functions = functionNames.map(extract).join("\n");

function makeQueryRecorder(onRange = () => Promise.resolve({ data: [], error: null })) {
  const calls = [];
  const client = {
    from(table) { calls.push(["from", table]); return query; }
  };
  const query = {};
  for (const method of ["select", "neq", "eq", "ilike", "or", "in", "order"]) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.range = (...args) => { calls.push(["range", ...args]); return onRange(calls); };
  return { client, calls };
}

function makeApi({ client, state, elements, pending } = {}) {
  const sandbox = {
    state,
    supabaseClient: client,
    $: id => elements[id],
    showListSkeleton() {},
    renderDirectory() {},
    recordPerf() {},
    performance: { now: () => 1 },
    console: { error() {} },
    document: {
      createElement() {
        return { className: "", textContent: "" };
      }
    }
  };
  if (pending) sandbox.pending = pending;
  return vm.runInNewContext(
    "(function(){ " + functions + "; return { normalizeDirectoryDigits, normalizeDirectorySearch, directoryMembershipDigits, buildDirectoryQuery, loadDirectory }; })()",
    sandbox
  );
}

test("builds a verified exact PostgREST filter for a full Arabic member number", async () => {
  const { client, calls } = makeQueryRecorder();
  const api = makeApi({ client, state: {} });
  await api.buildDirectoryQuery(client, "current-user", "٩٧١-٠٠٠-٠٠٠-٠٠١", "all", new Set(), 0, 49);
  assert.ok(calls.some(call => call[0] === "eq" && call[1] === "membership_number_verified" && call[2] === true));
  assert.ok(calls.some(call => call[0] === "eq" && call[1] === "membership_number" && call[2] === "971000000001"));
  assert.ok(!calls.some(call => call[0] === "or"));
  assert.deepEqual(calls.at(-1), ["range", 0, 49]);
});

test("builds prefix search for partial Persian member numbers", async () => {
  const { client, calls } = makeQueryRecorder();
  const api = makeApi({ client, state: {} });
  await api.buildDirectoryQuery(client, "current-user", "۹۷۱۰۰۰", "all", new Set(), 0, 49);
  assert.ok(calls.some(call => call[0] === "eq" && call[1] === "membership_number_verified" && call[2] === true));
  assert.ok(calls.some(call => call[0] === "ilike" && call[1] === "membership_number" && call[2] === "971000%"));
  assert.ok(!calls.some(call => call[0] === "or"));
});

test("builds name and @username OR search without applying membership filters", async () => {
  const { client, calls } = makeQueryRecorder();
  const api = makeApi({ client, state: {} });
  await api.buildDirectoryQuery(client, "current-user", "  @محمد  ", "all", new Set(), 0, 49);
  assert.ok(calls.some(call => call[0] === "or" && call[1] === "display_name.ilike.%محمد%,username.ilike.%محمد%"));
  assert.ok(!calls.some(call => call[0] === "eq" && call[1] === "membership_number_verified"));
});

test("online filter is constrained to the supplied presence IDs and empty presence short-circuits", async () => {
  const { client, calls } = makeQueryRecorder();
  const api = makeApi({ client, state: {} });
  await api.buildDirectoryQuery(client, "current-user", "", "online", new Set(["member-a", "member-b"]), 50, 99);
  assert.ok(calls.some(call => call[0] === "in" && call[1] === "id" && call[2].join(",") === "member-a,member-b"));
  assert.deepEqual(calls.at(-1), ["range", 50, 99]);

  const empty = makeQueryRecorder();
  const emptyApi = makeApi({ client: empty.client, state: {} });
  assert.equal(await emptyApi.buildDirectoryQuery(empty.client, "current-user", "", "online", new Set(), 0, 49), null);
  assert.equal(empty.calls.filter(call => call[0] === "range").length, 0);
});

test("a late search response cannot overwrite the newest directory results", async () => {
  const pending = [];
  const { client } = makeQueryRecorder(() => new Promise(resolve => pending.push(resolve)));
  const state = {
    user: { id: "current-user" }, directoryOffset: 0, directoryUsers: [],
    directoryHasMore: false, directoryRequestId: 0, directoryLoading: false,
    directorySearch: "قديم", directoryFilter: "all", onlineUsers: new Set(),
    sidebarView: "users"
  };
  const loadMore = {
    disabled: false, textContent: "", classList: { add() {}, toggle() {} }
  };
  const elements = {
    loadMoreUsers: loadMore,
    directoryList: { replaceChildren() {}, append() {} },
    directorySummary: { textContent: "" }
  };
  const api = makeApi({ client, state, elements });
  const oldRequest = api.loadDirectory(true);
  state.directorySearch = "الأحدث";
  const newRequest = api.loadDirectory(true);
  assert.equal(pending.length, 2);

  pending[0]({ data: [{ id: "stale-result" }], error: null });
  await oldRequest;
  assert.equal(state.directoryLoading, true);
  assert.deepEqual(state.directoryUsers, []);

  pending[1]({ data: [{ id: "latest-result" }], error: null });
  await newRequest;
  assert.deepEqual(Array.from(state.directoryUsers, row => row.id), ["latest-result"]);
  assert.equal(state.directoryLoading, false);
});

test("directory query errors release the pagination control for retry", async () => {
  const { client } = makeQueryRecorder(() => Promise.resolve({ data: null, error: { message: "network" } }));
  const state = {
    user: { id: "current-user" }, directoryOffset: 0, directoryUsers: [],
    directoryHasMore: false, directoryRequestId: 0, directoryLoading: false,
    directorySearch: "", directoryFilter: "all", onlineUsers: new Set(),
    sidebarView: "users"
  };
  const loadMore = {
    disabled: false, textContent: "", classList: { add() { this.hidden = true; }, toggle() {} }
  };
  const elements = {
    loadMoreUsers: loadMore,
    directoryList: { replaceChildren() {}, append() {} },
    directorySummary: { textContent: "" }
  };
  const api = makeApi({ client, state, elements });
  await api.loadDirectory(true);
  assert.equal(loadMore.disabled, false);
  assert.equal(loadMore.textContent, "عرض المزيد من المستخدمين");
});
