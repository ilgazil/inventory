import test from "node:test";
import assert from "node:assert/strict";
import { parseDbUrl } from "../src/config.ts";

test("parseDbUrl : URL simple", () => {
  assert.deepEqual(parseDbUrl("mysql://user:pass@host.example.com:3307/REDACTED"), {
    host: "host.example.com",
    port: 3307,
    user: "user",
    password: "pass",
    database: "REDACTED",
  });
});

test("parseDbUrl : mot de passe avec @ et :", () => {
  const config = parseDbUrl("mysql://REDACTED:p@ss:wo:rd@db.example.com:3306/REDACTED");
  assert.equal(config.user, "REDACTED");
  assert.equal(config.password, "p@ss:wo:rd");
  assert.equal(config.host, "db.example.com");
  assert.equal(config.database, "REDACTED");
});

test("parseDbUrl : % encodés sont décodés", () => {
  const config = parseDbUrl("mysql://u:p%40ss%3Ax@h:3306/db");
  assert.equal(config.password, "p@ss:x");
});

test("parseDbUrl : % brut toléré (pas de crash URIError)", () => {
  const config = parseDbUrl("mysql://u:pa%zz@h:3306/db");
  assert.equal(config.password, "pa%zz");
});

test("parseDbUrl : port et base par défaut", () => {
  const config = parseDbUrl("mysql://u:p@h/mydb");
  assert.equal(config.port, 3306);
  assert.equal(config.database, "mydb");
});

test("parseDbUrl : query string ignorée", () => {
  const config = parseDbUrl("mysql://u:p@h:3306/db?charset=utf8mb4");
  assert.equal(config.database, "db");
});
