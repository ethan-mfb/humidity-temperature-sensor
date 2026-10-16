import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../install-hts.sh", import.meta.url));

// A pi in a temp directory: the web root releases go into, a stand-in for
// pi-status that records being run, and somewhere to make tarballs.
function createPi() {
  const dir = mkdtempSync(join(tmpdir(), "install-hts-"));
  const webRoot = join(dir, "www");
  const piStatusLog = join(dir, "pi-status.log");
  const piStatus = join(dir, "pi-status");
  mkdirSync(join(webRoot, "releases"), { recursive: true });
  writeFileSync(piStatus, `#!/bin/sh\necho ran >> "${piStatusLog}"\n`, {
    mode: 0o755,
  });

  const env = {
    ...process.env,
    HTS_WEB_ROOT: webRoot,
    HTS_PI_STATUS: piStatus,
    HTS_RELEASES_URL: `file://${join(dir, "download")}`,
    HTS_REPO_DIR: join(dir, "repo"),
  };

  return {
    dir,
    webRoot,
    run: (...args) =>
      spawnSync("bash", [SCRIPT, ...args], { env, encoding: "utf8" }),
    current: () => readlinkSync(join(webRoot, "current")),
    releases: () => readdirSync(join(webRoot, "releases")).sort(),
    piStatusRuns: () =>
      existsSync(piStatusLog)
        ? readFileSync(piStatusLog, "utf8").trim().split("\n").length
        : 0,
  };
}

// What `tar -czf hts-<version>.tgz -C dist .` makes in the release steps.
function makeBuild(dir, version, files = { "index.html": version }) {
  const dist = mkdtempSync(join(dir, "dist-"));
  Object.entries(files).forEach(([name, content]) =>
    writeFileSync(join(dist, name), content),
  );
  const tarball = join(dir, `hts-${version}.tgz`);
  execFileSync("tar", ["-czf", tarball, "-C", dist, "."]);
  return tarball;
}

test("installs a local build as a release and serves it", () => {
  const pi = createPi();

  const result = pi.run(makeBuild(pi.dir, "0.1.1"));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(pi.current(), join(pi.webRoot, "releases", "0.1.1"));
  assert.equal(
    readFileSync(join(pi.webRoot, "current", "index.html"), "utf8"),
    "0.1.1",
  );
  assert.equal(pi.piStatusRuns(), 1);
});

test("leaves the release readable by nginx", () => {
  const pi = createPi();

  pi.run(makeBuild(pi.dir, "0.1.1"));

  const mode = statSync(join(pi.webRoot, "releases", "0.1.1")).mode & 0o777;
  assert.equal(mode, 0o755);
});

test("refuses a version that is already installed", () => {
  const pi = createPi();
  const tarball = makeBuild(pi.dir, "0.1.1");
  pi.run(tarball);
  pi.run(makeBuild(pi.dir, "0.1.2"));

  const result = pi.run(tarball);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already installed/);
  assert.equal(pi.current(), join(pi.webRoot, "releases", "0.1.2"));
});

test("rejects a build without an index.html and leaves no release behind", () => {
  const pi = createPi();

  const result = pi.run(
    makeBuild(pi.dir, "0.1.1", { "other.html": "not the app" }),
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /index\.html/);
  assert.deepEqual(pi.releases(), []);
  assert.equal(pi.piStatusRuns(), 0);
});

test("rejects a file not named hts-<version>.tgz", () => {
  const pi = createPi();
  const tarball = join(pi.dir, "build.tgz");
  execFileSync("tar", ["-czf", tarball, "-T", "/dev/null"]);

  const result = pi.run(tarball);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /hts-<version>\.tgz/);
});

test("keeps the three newest releases", () => {
  const pi = createPi();
  ["0.1.9", "0.1.10", "0.2.0", "0.1.8"].forEach((version) =>
    pi.run(makeBuild(pi.dir, version)),
  );

  // 0.1.8 is live, so it stays even though it is the oldest.
  assert.deepEqual(pi.releases(), ["0.1.10", "0.1.8", "0.2.0"]);
  assert.equal(pi.current(), join(pi.webRoot, "releases", "0.1.8"));
});

test("downloads a version from the releases", () => {
  const pi = createPi();
  const download = join(pi.dir, "download", "hts-v0.3.0");
  mkdirSync(download, { recursive: true });
  execFileSync("mv", [makeBuild(pi.dir, "0.3.0"), download]);

  const result = pi.run("0.3.0");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(pi.current(), join(pi.webRoot, "releases", "0.3.0"));
});

test("with no argument, installs the newest hts tag", () => {
  const pi = createPi();
  const repo = join(pi.dir, "repo");
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  mkdirSync(repo);
  git("init", "-q");
  git(
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "release",
  );
  ["hts-v0.2.0", "hts-v0.10.0", "hts-v0.9.0", "pi-image-v9.0.0"].forEach(
    (tag) => git("tag", tag),
  );
  const download = join(pi.dir, "download", "hts-v0.10.0");
  mkdirSync(download, { recursive: true });
  execFileSync("mv", [makeBuild(pi.dir, "0.10.0"), download]);

  const result = pi.run();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(pi.current(), join(pi.webRoot, "releases", "0.10.0"));
});
