#!/usr/bin/env node
// Génère un hash bcrypt pour la variable AUTH_PASSWORD_HASH du backend.
// Usage : node scripts/hash-password.mjs "<mot de passe>"
import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password || password.length < 6) {
  console.error("Usage : node backend/scripts/hash-password.mjs <mot de passe (6 caractères min.)>");
  process.exit(1);
}

console.log(bcrypt.hashSync(password, 10));
